import { describe, it, expect } from 'vitest';
import { friendlyError } from './callableError';

const err = (code: string, message: string) => Object.assign(new Error(message), { code });

describe('friendlyError', () => {
  it('bare lowercase "internal" (no HTTP response) is explained as a network block, not printed', () => {
    const msg = friendlyError(err('functions/internal', 'internal'), 'Could not save.');
    expect(msg).toMatch(/Couldn't reach HEIMDALL's server/);
    expect(msg).toMatch(/\*\.run\.app/);
    expect(friendlyError(err('functions/internal', ''))).toMatch(/Couldn't reach HEIMDALL's server/);
  });
  it('a genuine server crash (UPPERCASE status) is a "try again", not a network story', () => {
    const msg = friendlyError(err('functions/internal', 'INTERNAL'));
    expect(msg).toMatch(/went wrong on our side/);
    expect(msg).not.toMatch(/web filter/);
  });
  it('maps timeout / expired sign-in / throttling codes', () => {
    expect(friendlyError(err('functions/unavailable', 'x'))).toMatch(/didn't respond in time/);
    expect(friendlyError(err('functions/deadline-exceeded', 'x'))).toMatch(/didn't respond in time/);
    expect(friendlyError(err('functions/unauthenticated', 'x'))).toMatch(/sign in again/);
    expect(friendlyError(err('functions/resource-exhausted', 'x'))).toMatch(/Too many requests/);
    // …but a lockout the server wrote for humans (it says how long to wait) passes through.
    expect(friendlyError(err('functions/resource-exhausted', 'Too many join codes tried — wait an hour and try again.')))
      .toBe('Too many join codes tried — wait an hour and try again.');
  });
  it('passes a real HttpsError message through, minus the SDK prefix', () => {
    expect(friendlyError(err('functions/permission-denied', 'Only an administrator may do that.'))).toBe('Only an administrator may do that.');
    expect(friendlyError(new Error('FirebaseError: That slot is full.'))).toBe('That slot is full.');
  });
  it('falls back for non-Error values and empty messages', () => {
    expect(friendlyError(null, 'Could not save.')).toBe('Could not save.');
    expect(friendlyError('boom', 'Could not save.')).toBe('Could not save.');
    expect(friendlyError(undefined)).toBe('Something went wrong.');
    expect(friendlyError(new Error(''), 'Could not save.')).toBe('Could not save.');
  });
});
