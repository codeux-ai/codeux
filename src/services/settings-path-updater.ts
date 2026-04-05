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
      if (part === '__proto__' || part === 'constructor' || part === 'prototype') {
        throw new Error(`Invalid path part: ${part}`);
      }
    }

    const result = { ...obj };
    let current: any = result;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (current[part] === undefined || current[part] === null) {
        current[part] = {};
      } else if (typeof current[part] === 'object') {
        current[part] = Array.isArray(current[part]) ? [...current[part]] : { ...current[part] };
      } else {
        throw new Error(`Cannot traverse through primitive at path: ${parts.slice(0, i + 1).join('.')}`);
      }
      current = current[part];
    }

    current[parts[parts.length - 1]] = value;
    return result;
  }
}
