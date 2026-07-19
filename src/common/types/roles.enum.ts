// Portal roles. Developers are NOT portal users — they live in the separate
// `developers` collection and never authenticate.
export enum UserRole {
  ADMIN = 'admin',
  MANAGER = 'manager',
}
