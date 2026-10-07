/**
 * Undo/redo over immutable snapshots. Every edit produces a new value, so a
 * history entry is just the previous value — no inverse operations to keep
 * correct.
 */
export class History<T> {
  private past: T[] = []
  private future: T[] = []

  constructor(private readonly limit = 200) {}

  /** Record `previous` as the state to return to, and forget anything redoable. */
  push(previous: T): void {
    this.past.push(previous)
    if (this.past.length > this.limit) this.past.shift()
    this.future = []
  }

  /** The state to restore, given the current one; `undefined` when there is nothing to undo. */
  undo(current: T): T | undefined {
    const previous = this.past.pop()
    if (previous !== undefined) this.future.push(current)
    return previous
  }

  redo(current: T): T | undefined {
    const next = this.future.pop()
    if (next !== undefined) this.past.push(current)
    return next
  }

  get canUndo(): boolean {
    return this.past.length > 0
  }

  get canRedo(): boolean {
    return this.future.length > 0
  }

  clear(): void {
    this.past = []
    this.future = []
  }
}
