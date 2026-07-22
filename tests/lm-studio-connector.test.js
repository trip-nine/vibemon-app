const { LmStudioConnector, parseModels } = require('../src/modules/lm-studio-connector.cjs');

describe('LM Studio connector', () => {
  test('keeps only local model metadata needed by the dashboard', () => {
    expect(parseModels(JSON.stringify([{
      identifier: 'google/gemma', displayName: 'Gemma', status: 'idle',
      sizeBytes: 123, contextLength: 8192, maxContextLength: 65536,
      quantization: 'Q4_K_M', secret: 'discard-me'
    }]))).toEqual([{
      identifier: 'google/gemma', displayName: 'Gemma', architecture: null,
      quantization: 'Q4_K_M', status: 'idle', sizeBytes: 123,
      contextLength: 8192, maxContextLength: 65536, parallelRequests: null
    }]);
  });

  test('uses the documented local lms process command', () => {
    const exec = jest.fn(() => '{"models":[]}');
    const connector = new LmStudioConnector({ execFileSync: exec });
    expect(connector.inspect()).toMatchObject({ available: true, models: [] });
    expect(exec).toHaveBeenCalledWith('lms', ['ps', '--json'], expect.any(Object));
  });

  test('fails closed when the CLI is unavailable', () => {
    const connector = new LmStudioConnector({ execFileSync: () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); } });
    expect(connector.inspect()).toEqual({ available: false, models: [], error: 'lms-cli-not-found' });
  });
});
