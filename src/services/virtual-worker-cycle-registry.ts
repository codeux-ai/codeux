export type VirtualWorkerCycleKind = "attention" | "dispatch";

export interface VirtualWorkerCycleReservation {
  id: string;
  projectId: string;
  kind: VirtualWorkerCycleKind;
  attentionItemId?: string;
  dispatchId?: string;
  taskId?: string;
  providerId?: string;
}

/**
 * Tracks only in-process scheduling conflicts. Durable dispatch leases and
 * attention claims remain the cross-process ownership boundary.
 */
export class VirtualWorkerCycleRegistry {
  private readonly reservations = new Map<string, VirtualWorkerCycleReservation>();
  private readonly projectReservationIds = new Map<string, Set<string>>();

  tryReserve(reservation: VirtualWorkerCycleReservation, maxProjectCycles: number): boolean {
    const projectReservations = this.listProject(reservation.projectId);
    if (reservation.kind === "attention") {
      if (projectReservations.length > 0) {
        return false;
      }
    } else {
      if (projectReservations.some((active) => active.kind === "attention")) {
        return false;
      }
      if (projectReservations.length >= Math.max(1, maxProjectCycles)) {
        return false;
      }
      if (projectReservations.some((active) => (
        active.dispatchId === reservation.dispatchId
        || (Boolean(active.taskId) && active.taskId === reservation.taskId)
      ))) {
        return false;
      }
    }

    this.reservations.set(reservation.id, reservation);
    let projectIds = this.projectReservationIds.get(reservation.projectId);
    if (!projectIds) {
      projectIds = new Set<string>();
      this.projectReservationIds.set(reservation.projectId, projectIds);
    }
    projectIds.add(reservation.id);
    return true;
  }

  release(reservationId: string): void {
    const reservation = this.reservations.get(reservationId);
    if (!reservation) {
      return;
    }
    this.reservations.delete(reservationId);
    const projectIds = this.projectReservationIds.get(reservation.projectId);
    projectIds?.delete(reservationId);
    if (projectIds?.size === 0) {
      this.projectReservationIds.delete(reservation.projectId);
    }
  }

  countProject(projectId: string): number {
    return this.projectReservationIds.get(projectId)?.size ?? 0;
  }

  hasAttention(projectId: string): boolean {
    return this.listProject(projectId).some((reservation) => reservation.kind === "attention");
  }

  hasDispatchConflict(projectId: string, dispatchId: string, taskId: string): boolean {
    return this.listProject(projectId).some((reservation) => (
      reservation.kind === "dispatch"
      && (reservation.dispatchId === dispatchId || reservation.taskId === taskId)
    ));
  }

  countProvider(providerId: string): number {
    let count = 0;
    for (const reservation of this.reservations.values()) {
      if (reservation.providerId === providerId) {
        count += 1;
      }
    }
    return count;
  }

  listProjectIds(): string[] {
    return Array.from(this.projectReservationIds.keys());
  }

  private listProject(projectId: string): VirtualWorkerCycleReservation[] {
    const ids = this.projectReservationIds.get(projectId);
    if (!ids) {
      return [];
    }
    return Array.from(ids)
      .map((id) => this.reservations.get(id))
      .filter((reservation): reservation is VirtualWorkerCycleReservation => Boolean(reservation));
  }
}
