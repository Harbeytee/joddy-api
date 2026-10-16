import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const IS_OPTIONAL_AUTH_KEY = 'isOptionalAuth';

/** Opts a route out of the global JWT guard. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Open to guests, but personalised when signed in: `@CurrentUser()` is undefined for guests.
 * A token that is present but invalid or expired still gets a 401, so clients refresh instead of
 * silently falling back to guest data.
 */
export const OptionalAuth = () => SetMetadata(IS_OPTIONAL_AUTH_KEY, true);
