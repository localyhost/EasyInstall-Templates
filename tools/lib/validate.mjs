// Core of the validation: schema + logic checks for all templates of a repo.
import { loadTemplates } from './load.mjs';
import { validateSchema } from './schema.mjs';
import { runTemplateChecks, runCrossChecks } from './checks.mjs';

/**
 * Validates all templates below root.
 * @returns {Promise<Array<{id, relFile, isStarter, errors: string[], warnings: string[], tpl}>>}
 */
export async function validateRepo(root, { now = new Date() } = {}) {
  const templates = await loadTemplates(root);
  const results = templates.map((tpl) => validateTemplate(tpl, now));

  const cross = runCrossChecks(templates);
  for (const r of results) r.errors.push(...(cross.get(r.relFile) ?? []));
  return results;
}

function validateTemplate(tpl, now) {
  const result = { id: tpl.id, relFile: tpl.relFile, isStarter: tpl.isStarter, errors: [], warnings: [], tpl };
  if (tpl.missing) {
    result.errors.push('template.yaml is missing');
    return result;
  }
  if (tpl.parseError) {
    result.errors.push(`YAML syntax error: ${tpl.parseError}`);
    return result;
  }
  result.errors.push(...validateSchema(tpl.data));
  // Logic checks only run on schema-valid data; otherwise they only produce follow-up errors.
  if (result.errors.length === 0) {
    runTemplateChecks(tpl, { error: (m) => result.errors.push(m), warn: (m) => result.warnings.push(m) }, now);
  }
  return result;
}
