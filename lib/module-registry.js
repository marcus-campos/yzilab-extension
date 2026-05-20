// Registry de módulos de integração (Petlove, futuros parceiros, etc).
// Cada módulo expõe { id, label, tabs:[{id, label, mount(container)}], hooks? }.

const registry = new Map();

export function register(module) {
  if (!module || !module.id) throw new Error("module must have an id");
  registry.set(module.id, module);
}

export function list() {
  return Array.from(registry.values());
}

export function get(id) {
  return registry.get(id);
}
