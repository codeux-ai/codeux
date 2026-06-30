// Keys that must never be writable through a dotted path, since assigning to
// them can pollute the prototype chain of every object in the process.
const UNSAFE_PATH_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export class SettingsPathUpdater {
  /**
   * Patches a nested property in an object given a dotted path.
   * Returns a new object with the cloned path, leaving other references intact.
   */
  static patchObject<T extends Record<string, any>>(obj: T, path: string, value: any): T {
    if (!obj || typeof obj !== 'object') {
      throw new Error('Target must be an object');
    }

    if (!path) {
      throw new Error('Path cannot be empty');
    }

    const parts = path.split('.');
    for (const part of parts) {
      if (UNSAFE_PATH_KEYS.has(part)) {
        throw new Error(`Invalid path part: ${part}`);
      }
    }

    const result = { ...obj };
    let current: any = result;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      // Only treat own properties as existing nodes — never descend into an
      // inherited prototype property — and clone as we go so the input is left
      // untouched.
      const existing = Object.prototype.hasOwnProperty.call(current, part) ? current[part] : undefined;
      if (existing === undefined || existing === null) {
        current[part] = {};
      } else if (typeof existing === 'object') {
        current[part] = Array.isArray(existing) ? [...existing] : { ...existing };
      } else {
        throw new Error(`Cannot traverse through primitive at path: ${parts.slice(0, i + 1).join('.')}`);
      }
      current = current[part];
    }

    current[parts[parts.length - 1]] = value;
    return result;
  }
}
