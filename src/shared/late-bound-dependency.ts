export class LateBoundDependency<T> {
  private value: T | undefined;

  constructor(private readonly label: string) {}

  get(): T {
    if (this.value === undefined) {
      throw new Error(`Late-bound dependency "${this.label}" has not been linked.`);
    }
    return this.value;
  }

  set(value: T): void {
    this.value = value;
  }

  isLinked(): boolean {
    return this.value !== undefined;
  }
}

export type LateBoundOrValue<T> = T | LateBoundDependency<T>;

export function createLateBoundDependency<T>(label: string): LateBoundDependency<T> {
  return new LateBoundDependency<T>(label);
}

export function resolveLateBoundDependency<T>(dependency: LateBoundOrValue<T>): T {
  return dependency instanceof LateBoundDependency ? dependency.get() : dependency;
}
