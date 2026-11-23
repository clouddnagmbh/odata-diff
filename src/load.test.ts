import { describe, expect, it } from 'vitest';
import { displayName, isUrl, LoadError, loadMetadata, metadataUrl, parseHeaders } from './load';
import { testIo } from './test-io';

describe('metadataUrl', () => {
  it('appends $metadata to a service URL and keeps the query', () => {
    expect(metadataUrl('https://h/sap/opu/odata/sap/ZSRV/')).toBe(
      'https://h/sap/opu/odata/sap/ZSRV/$metadata',
    );
    expect(metadataUrl('https://h/odata/v4/orders?sap-client=100')).toBe(
      'https://h/odata/v4/orders/$metadata?sap-client=100',
    );
    expect(metadataUrl('http://localhost:4004/odata/v4/orders/$metadata')).toBe(
      'http://localhost:4004/odata/v4/orders/$metadata',
    );
  });

  it('takes document URLs as they are', () => {
    const raw = 'https://raw.githubusercontent.com/o/r/main/api/metadata.xml';
    expect(metadataUrl(raw)).toBe(raw);
    expect(metadataUrl('https://h/files/orders.JSON')).toBe('https://h/files/orders.JSON');
    expect(metadataUrl('https://h/files/service.edmx?v=2')).toBe(
      'https://h/files/service.edmx?v=2',
    );
  });

  it('shows URLs without user info and query', () => {
    expect(displayName('https://user:secret@h/srv?sap-client=100')).toBe('https://h/srv/$metadata');
    expect(displayName('main/metadata.xml')).toBe('main/metadata.xml');
    expect(isUrl('HTTPS://h')).toBe(true);
    expect(isUrl('./https.xml')).toBe(false);
  });
});

describe('parseHeaders', () => {
  it('reads "Name: value" pairs, the value may contain colons', () => {
    expect(
      parseHeaders(['Authorization: Basic dTpw', 'sap-client:100', 'X-Url: https://a:b']),
    ).toEqual({
      Authorization: 'Basic dTpw',
      'sap-client': '100',
      'X-Url': 'https://a:b',
    });
  });

  it('rejects malformed headers without echoing the value', () => {
    expect(() => parseHeaders(['Bearer secret-token'])).toThrow(LoadError);
    expect(() => parseHeaders(['Bearer secret-token'])).not.toThrow(/secret-token/);
  });
});

describe('loadMetadata', () => {
  it('reads EDMX and CSDL JSON files', async () => {
    const { io } = testIo();
    expect((await loadMetadata('v1.xml', {}, io)).entitySets.map((set) => set.name)).toEqual([
      'Orders',
    ]);
    const xml = await loadMetadata('cap-orders.xml', {}, testIo().io);
    const json = await loadMetadata('cap-orders.json', {}, testIo().io);
    expect(json.entitySets.map((set) => set.name).sort()).toEqual(
      xml.entitySets.map((set) => set.name).sort(),
    );
  });

  it('fetches URLs with the given headers and an Accept header', async () => {
    const { io, requests } = testIo({
      responses: { 'https://h/srv/$metadata': { status: 200, body: '{"$Version":"4.0"}' } },
    });
    await loadMetadata('https://h/srv', { Authorization: 'Basic x' }, io);
    expect(requests[0]).toEqual({
      url: 'https://h/srv/$metadata',
      headers: { accept: 'application/xml, application/json;q=0.9', Authorization: 'Basic x' },
    });
  });

  it('names the problem: missing file, HTTP status, network, not $metadata', async () => {
    const { io } = testIo({
      files: { 'page.html': '<html><body>Login</body></html>' },
      responses: { 'https://h/srv/$metadata': { status: 401, body: '' } },
    });
    await expect(loadMetadata('missing.xml', {}, io)).rejects.toThrow(
      'missing.xml: file not found',
    );
    await expect(loadMetadata('https://h/srv', {}, io)).rejects.toThrow(
      'https://h/srv/$metadata: HTTP 401 Unauthorized',
    );
    await expect(loadMetadata('https://other/srv', {}, io)).rejects.toThrow('ENOTFOUND');
    await expect(loadMetadata('page.html', {}, io)).rejects.toThrow(
      'page.html: not a $metadata document',
    );
  });
});
