interface ActiveRun {
  ownerUserId: string;
  controller: AbortController;
}

export class ActiveRuns {
  private readonly runs = new Map<string, ActiveRun>();

  register(
    runId: string,
    ownerUserId: string,
    controller: AbortController,
  ): void {
    if (this.runs.has(runId)) throw new Error(`Duplicate active run: ${runId}`);
    this.runs.set(runId, { ownerUserId, controller });
  }

  unregister(runId: string): void {
    this.runs.delete(runId);
  }

  cancel(runId: string, requesterUserId: string): boolean {
    const run = this.runs.get(runId);
    if (
      run === undefined ||
      run.ownerUserId !== requesterUserId ||
      run.controller.signal.aborted
    ) {
      return false;
    }
    run.controller.abort();
    return true;
  }

  cancelAll(): void {
    for (const run of this.runs.values()) run.controller.abort();
  }

  list(): readonly { runId: string; ownerUserId: string }[] {
    return Object.freeze(
      [...this.runs.entries()].map(([runId, run]) =>
        Object.freeze({ runId, ownerUserId: run.ownerUserId }),
      ),
    );
  }
}
