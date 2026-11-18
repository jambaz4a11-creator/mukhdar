// حارس هدف سكربت الصور. الافتراضي: تطوير فقط (نفس حارس seed:demo: قائمة المراجع + علامة private.deployment).
// الإنتاج مسار صريح ثلاثي: --target=prod + MUKHDAR_TARGET=prod + --confirm-ref=<ref المشروع المربوط>، والـ ref لازم
// يكون ref الإنتاج الحقيقي المعرّف بـ scripts/lib/projects.mjs (القيمة المحجوزة ترفض كل شيء).
import { assertSafeTarget } from '../lib/db.mjs';
import { PROD_PROJECT_REFS, classifyRef } from '../lib/projects.mjs';

/** يرجع 'dev' | 'prod' أو يرمي. لا يرجع 'prod' إلا بالشروط الثلاثة. */
export function resolveImageTarget(
  target,
  args,
  env = process.env,
  lists = { prod: PROD_PROJECT_REFS },
) {
  if (!args.includes('--target=prod')) {
    assertSafeTarget(target, env);
    return 'dev';
  }
  if (target.kind !== 'remote') {
    throw new Error('Refusing: --target=prod needs --remote (the linked project).');
  }
  if (env.MUKHDAR_TARGET !== 'prod') {
    throw new Error('Refusing: production target needs MUKHDAR_TARGET=prod in the environment.');
  }
  const confirm = args.find((a) => a.startsWith('--confirm-ref='))?.slice('--confirm-ref='.length);
  if (!confirm || confirm !== target.projectRef) {
    throw new Error(
      `Refusing: pass --confirm-ref=${target.projectRef ?? '<linked ref>'} to confirm the production project.`,
    );
  }
  if (classifyRef(target.projectRef, [], lists.prod) !== 'prod') {
    throw new Error(
      `Refusing: ${target.projectRef} is not the known production project (scripts/lib/projects.mjs).`,
    );
  }
  return 'prod';
}
