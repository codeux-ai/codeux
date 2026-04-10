export class LateBoundLink<T> {
  private instance: T | null = null;
  private readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  public bind(instance: T): void {
    if (this.instance !== null) {
      throw new Error(`LateBoundLink '${this.name}' has already been bound.`);
    }
    this.instance = instance;
  }

  public get(): T {
    if (this.instance === null) {
      throw new Error(`LateBoundLink '${this.name}' has not been bound yet.`);
    }
    return this.instance;
  }
}
