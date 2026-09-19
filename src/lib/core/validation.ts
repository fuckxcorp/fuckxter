const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}\p{M}_-]{1,31}$/u;

export function isValidEmail(value: string): boolean {
  return value.length <= 254 && EMAIL_PATTERN.test(value);
}

export function isValidUsername(value: string): boolean {
  return USERNAME_PATTERN.test(value.normalize("NFKC"));
}

export function usernameKey(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("und");
}

export function isValidBirthday(value: string): boolean {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  const today = new Date().toISOString().slice(0, 10);
  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value &&
    value >= "1700-01-01" &&
    value <= today
  );
}
