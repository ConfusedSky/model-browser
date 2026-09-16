/**
 * A preference kept in `localStorage`, per browser profile.
 *
 * Neither half may throw: reads happen at module init, where an exception takes
 * the app down before it renders, and storage can be absent or refused. `parse`
 * is the single place a stored value is validated, and a malformed one reads as
 * the default.
 */
export interface Stored<T> {
  read(): T;
  write(value: T): void;
}

export function stored<T>(
  key: string,
  parse: (raw: string | null) => T,
  serialize: (value: T) => string,
): Stored<T> {
  return {
    read() {
      try {
        return parse(localStorage.getItem(key));
      } catch {
        return parse(null);
      }
    },
    write(value) {
      try {
        localStorage.setItem(key, serialize(value));
      } catch {
        // no localStorage (tests) — in-memory only
      }
    },
  };
}
