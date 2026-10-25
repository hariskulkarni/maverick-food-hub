/**
 * Reply templates: owner-editable snippets with {name} and {dish} variables.
 * Pure so the admin UI renders exactly what will be posted.
 */
export const TEMPLATE_VARIABLES = ['{name}', '{dish}'] as const;

export const STARTER_TEMPLATES: Array<{ name: string; body: string }> = [
  { name: 'Thank you (5★)', body: 'Thank you so much, {name}! We are thrilled you enjoyed the {dish}. Hope to serve you again soon.' },
  { name: 'Glad you liked it', body: 'Thanks for the kind words, {name}. Our kitchen team will be happy to hear the {dish} hit the spot.' },
  { name: 'Sorry, we will fix it', body: 'Hi {name}, we are sorry your experience fell short. We would like to make this right, please reach out to us through the app so we can look into it.' },
];

export function firstNameOf(name: string | null | undefined): string {
  const first = (name ?? '').trim().split(/\s+/)[0];
  return first || 'there';
}

/** Fill {name}/{dish}; a missing dish collapses "the {dish}" to "your order". */
export function renderTemplate(body: string, vars: { name?: string | null; dish?: string | null }): string {
  const name = firstNameOf(vars.name);
  const dish = (vars.dish ?? '').trim();
  let out = body;
  if (!dish) out = out.replace(/\b(the|your)\s+\{dish\}/gi, 'your order').replace(/\{dish\}/gi, 'your order');
  return out.replace(/\{name\}/gi, name).replace(/\{dish\}/gi, dish).replace(/\s{2,}/g, ' ').trim();
}
