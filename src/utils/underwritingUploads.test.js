import { withTimeout, READ_TIMEOUT_MSG } from './underwritingUploads';

test('a read that never settles fails with the read-timeout message', async () => {
  jest.useFakeTimers();
  const pending = withTimeout(new Promise(() => {}), 30000);
  jest.advanceTimersByTime(30000);
  await expect(pending).rejects.toThrow(READ_TIMEOUT_MSG);
  jest.useRealTimers();
});

test('a read that settles in time passes its result or error through', async () => {
  await expect(withTimeout(Promise.resolve('ok'), 1000)).resolves.toBe('ok');
  const pwErr = Object.assign(new Error('No password given'), { name: 'PasswordException', code: 1 });
  await expect(withTimeout(Promise.reject(pwErr), 1000)).rejects.toBe(pwErr);
});
