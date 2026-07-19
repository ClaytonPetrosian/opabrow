import { safeStorage } from 'electron';
import { parse } from 'csv-parse/sync';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const MAX_IMPORTED_PASSWORDS = 5_000;

export type PasswordMatch = {
  id: string;
  origin: string;
  username: string;
};

export type PasswordToFill = PasswordMatch & {
  password: string;
};

type ImportedPassword = {
  origin: string;
  username: string;
  password: string;
};

type StoredPassword = PasswordMatch & {
  encryptedPassword: string;
  createdAt: number;
  updatedAt: number;
};

type PasswordDocument = {
  version: 1;
  passwords: StoredPassword[];
};

export type PasswordImportResult = {
  added: number;
  updated: number;
  rejected: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    return url.origin.toLowerCase();
  } catch {
    return null;
  }
}

function sanitizeStoredPassword(value: unknown): StoredPassword | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== 'string' ||
    typeof value.origin !== 'string' ||
    typeof value.username !== 'string' ||
    typeof value.encryptedPassword !== 'string' ||
    typeof value.createdAt !== 'number' ||
    typeof value.updatedAt !== 'number'
  ) {
    return null;
  }

  const origin = normalizeOrigin(value.origin);
  if (!origin || !value.encryptedPassword) return null;

  return {
    id: value.id,
    origin,
    username: value.username,
    encryptedPassword: value.encryptedPassword,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt
  };
}

function normalizeHeaders(row: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key.trim().toLowerCase(), value]));
}

export function parseChromePasswordCsv(source: string): {
  passwords: ImportedPassword[];
  rejected: number;
} {
  let rows: Array<Record<string, string>>;
  try {
    rows = parse(source, {
      bom: true,
      columns: true,
      skip_empty_lines: true,
      relax_column_count: false,
      max_record_size: 1024 * 1024
    }) as Array<Record<string, string>>;
  } catch {
    throw new Error('无法读取 Chrome 密码 CSV。请确认选择的是 Chrome 密码管理器导出的 CSV 文件。');
  }

  if (rows.length > MAX_IMPORTED_PASSWORDS) {
    throw new Error(`密码 CSV 最多可导入 ${MAX_IMPORTED_PASSWORDS} 条记录。`);
  }

  const passwords: ImportedPassword[] = [];
  let rejected = 0;

  for (const rawRow of rows) {
    const row = normalizeHeaders(rawRow);
    const origin = normalizeOrigin(row.url || '');
    const username = typeof row.username === 'string' ? row.username.trim() : '';
    const password = typeof row.password === 'string' ? row.password : '';
    if (!origin || !password) {
      rejected += 1;
      continue;
    }

    passwords.push({ origin, username, password });
  }

  if (passwords.length === 0) {
    throw new Error('所选 CSV 中没有可导入的 HTTPS 密码记录。');
  }

  return { passwords, rejected };
}

export class PasswordStore {
  private passwords: StoredPassword[] = [];

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    try {
      const content = await readFile(this.filePath, 'utf8');
      const document = JSON.parse(content) as unknown;
      if (!isRecord(document) || !Array.isArray(document.passwords)) return;
      this.passwords = document.passwords
        .map(sanitizeStoredPassword)
        .filter((password): password is StoredPassword => password !== null);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') console.warn('Could not load password store:', error);
    }
  }

  async importChromeCsv(filePath: string): Promise<PasswordImportResult> {
    await this.ensureEncryption();
    const source = await readFile(filePath, 'utf8');
    const { passwords, rejected } = parseChromePasswordCsv(source);
    const now = Date.now();
    let added = 0;
    let updated = 0;

    for (const password of passwords) {
      const encryptedPassword = (await safeStorage.encryptStringAsync(password.password)).toString('base64');
      const existing = this.passwords.find(
        (stored) => stored.origin === password.origin && stored.username === password.username
      );

      if (existing) {
        existing.encryptedPassword = encryptedPassword;
        existing.updatedAt = now;
        updated += 1;
        continue;
      }

      this.passwords.push({
        id: randomUUID(),
        origin: password.origin,
        username: password.username,
        encryptedPassword,
        createdAt: now,
        updatedAt: now
      });
      added += 1;
    }

    await this.save();
    return { added, updated, rejected };
  }

  getMatches(url: string): PasswordMatch[] {
    const origin = normalizeOrigin(url);
    if (!origin) return [];

    return this.passwords
      .filter((password) => password.origin === origin)
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map(({ id, origin: savedOrigin, username }) => ({ id, origin: savedOrigin, username }));
  }

  async getForFill(id: string, url: string): Promise<PasswordToFill | null> {
    await this.ensureEncryption();
    const origin = normalizeOrigin(url);
    if (!origin) return null;

    const stored = this.passwords.find((password) => password.id === id && password.origin === origin);
    if (!stored) return null;

    try {
      const decrypted = await safeStorage.decryptStringAsync(Buffer.from(stored.encryptedPassword, 'base64'));
      return {
        id: stored.id,
        origin: stored.origin,
        username: stored.username,
        password: decrypted.result
      };
    } catch {
      throw new Error('无法解锁已保存的密码。请确认 macOS 钥匙串可用。');
    }
  }

  async clear(): Promise<void> {
    this.passwords = [];
    await this.save();
  }

  hasPasswords(): boolean {
    return this.passwords.length > 0;
  }

  private async ensureEncryption(): Promise<void> {
    if (!(await safeStorage.isAsyncEncryptionAvailable())) {
      throw new Error('macOS 钥匙串不可用，无法安全导入密码。');
    }
  }

  private async save(): Promise<void> {
    const document: PasswordDocument = { version: 1, passwords: this.passwords };
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(document), 'utf8');
    await rename(temporaryPath, this.filePath);
  }
}
