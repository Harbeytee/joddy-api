import type { User } from '../../generated/prisma/client';
import { locationScope } from '../jobs/geo/location-scope';

export type PublicUser = Omit<User, 'passwordHash'> & {
  /** ISO country parsed from the free-text profile location; the jobs page's default location filter */
  countryCode: string | null;
};

export function toPublicUser(user: User): PublicUser {
  const { passwordHash, ...rest } = user;
  const { countries } = locationScope(user.location ? [user.location] : []);
  return { ...rest, countryCode: countries.length === 1 ? countries[0] : null };
}
