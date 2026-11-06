import type { SpecialtyRepository } from '../db/specialties.js';

export class SpecialtyResolver {
  constructor(private readonly repository: SpecialtyRepository) {}
  list() {
    return this.repository.list();
  }
  listByIds(ids: string[]) {
    return this.repository.listByIds(ids);
  }
  resolve(name: string) {
    return this.repository.resolve(name);
  }
  byId(id: string) {
    return this.repository.byId(id);
  }
  mentions(text: string, active = true) {
    return this.repository.mentions(text, active);
  }
}
