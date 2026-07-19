import { describe, expect, it } from 'vitest';
import { parseChromePasswordCsv } from './passwords';

describe('parseChromePasswordCsv', () => {
  it('parses Chrome CSV fields without losing quoted commas', () => {
    const result = parseChromePasswordCsv(
      'name,url,username,password,note\n"Example, Inc.",https://example.com/login,ada,"comma, password",note\n'
    );

    expect(result.rejected).toBe(0);
    expect(result.passwords).toEqual([
      { origin: 'https://example.com', username: 'ada', password: 'comma, password' }
    ]);
  });

  it('rejects non-HTTPS and blank password records', () => {
    const result = parseChromePasswordCsv(
      'name,url,username,password,note\nHTTP,http://example.com,ada,nope,\nBlank,https://example.com,ada,,\nOK,https://valid.example,bea,secret,\n'
    );

    expect(result.rejected).toBe(2);
    expect(result.passwords).toEqual([
      { origin: 'https://valid.example', username: 'bea', password: 'secret' }
    ]);
  });
});
