'use client';
// العناوين (أدمن، SPEC-admin §2.4): قطاع ← بلوك ← بناية. إضافة، تعديل الاسم، إخفاء (is_active)، وترتيب
// (القطاعات والبلوكات بالأسهم أو بالسحب). البنايات مرتبة بالرقم، وتُضاف بالجملة لبلوك ("1-100"،
// "1,2,5-9") مع معاينة قبل الحفظ، والمكرر يُتجاهل (add_buildings، on conflict do nothing).
// الكتابة المباشرة للأدمن بـ RLS؛ لا حذف (العناوين القديمة تشير للبنايات).
import { errorMessage, formatSector, normalizePin } from '@mukhdar/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { usePanel } from '@/components/PanelProviders';
import { MoveButtons, inputClass, moveItem, useDragOrder } from '@/features/catalog/ui';
import {
  addBuildings,
  adminKeys,
  createSector,
  createSubsection,
  fetchAddressTree,
  fetchAddressUsage,
  reorderAddressRows,
  updateAddressRow,
  type AddressTable,
  type BuildingRow,
  type SectorRow,
  type SubsectionRow,
} from './api';
import { compactRanges, parseBuildingNumbers, splitNew, validateBuildingNumber } from './forms';

function useAddressWrite() {
  const { supabase } = usePanel();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fn: (s: typeof supabase) => Promise<unknown>) => fn(supabase),
    onSettled: async () => {
      await qc.invalidateQueries({ queryKey: adminKeys.addresses });
    },
  });
}

function duplicateMessage(error: unknown): string {
  return (error as { code?: string } | null)?.code === '23505'
    ? 'الاسم أو الرقم موجود أصلاً بنفس المستوى'
    : errorMessage(error);
}

export function AddressesScreen() {
  const { supabase } = usePanel();
  const tree = useQuery({
    queryKey: adminKeys.addresses,
    queryFn: () => fetchAddressTree(supabase),
  });
  const [selected, setSelected] = useState<number | null>(null);
  const write = useAddressWrite();

  const sectors = tree.data ?? [];
  const unit = sectors.flatMap((s) => s.subsections).find((u) => u.id === selected) ?? null;
  const reorder = (table: AddressTable, rows: { id: number; sort_order: number }[]) =>
    write.mutate((s) =>
      reorderAddressRows(
        s,
        table,
        rows.map((r) => r.id),
        new Map(rows.map((r) => [r.id, r.sort_order])),
      ),
    );

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-0.5">
        <h1 className="m-0 text-[26px] font-bold">العناوين</h1>
        <span className="text-sm text-text-muted">
          قطاع ← بلوك ← بناية. المخفي ما يظهر للزبون، والعناوين المحفوظة عليه ما تقدر تطلب لحد ما
          ترجّعه.
        </span>
        <span className="text-sm text-text-muted">
          تعديل الاسم يغيّر العنوان عند كل زبون حافظه: ينعرض لك عددهم قبل الحفظ.
        </span>
      </header>
      {write.error && (
        <p
          role="alert"
          className="m-0 rounded-control bg-danger-soft px-3 py-2 text-sm text-danger"
        >
          {duplicateMessage(write.error)}
        </p>
      )}
      {tree.isPending && <p className="text-sm text-text-muted">جارٍ التحميل…</p>}

      <div className="flex flex-wrap items-start gap-4">
        <section
          aria-label="القطاعات والبلوكات"
          className="flex min-w-0 flex-[1_1_380px] flex-col gap-3"
        >
          <SectorList
            sectors={sectors}
            selected={selected}
            onSelect={setSelected}
            onReorder={reorder}
          />
          <AddRow
            label="قطاع جديد"
            placeholder="مثلاً: قطاع C"
            onAdd={(name) =>
              write.mutateAsync((s) =>
                createSector(
                  s,
                  formatSector(name),
                  (sectors.at(-1)?.sort_order ?? 0) + 1,
                  sectors[0]?.city_id ?? null,
                ),
              )
            }
          />
        </section>
        <section
          aria-label="البنايات"
          className="flex min-w-0 flex-[2_1_480px] flex-col gap-3 rounded-card border border-border bg-surface p-[18px]"
        >
          {unit ? (
            <UnitBuildings key={unit.id} unit={unit} />
          ) : (
            <p className="m-0 text-sm text-text-muted">
              اختر بلوك لعرض بناياتها وإضافة بنايات بالجملة.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

function SectorList({
  sectors,
  selected,
  onSelect,
  onReorder,
}: {
  sectors: SectorRow[];
  selected: number | null;
  onSelect: (id: number) => void;
  onReorder: (table: AddressTable, rows: { id: number; sort_order: number }[]) => void;
}) {
  const drag = useDragOrder(sectors, (next) => onReorder('sectors', next));
  return (
    <>
      {sectors.map((s, i) => (
        <div
          key={s.id}
          {...drag(i)}
          data-sector={s.name}
          className={`flex flex-col gap-2.5 rounded-card border border-border bg-surface p-3.5 ${
            s.is_active ? '' : 'opacity-70'
          }`}
        >
          <RowHeader
            table="sectors"
            row={s}
            label={s.name}
            value={s.name}
            title={<span className="text-[15px] font-bold">{s.name}</span>}
            move={
              <MoveButtons
                label={s.name}
                index={i}
                count={sectors.length}
                onMove={(to) => onReorder('sectors', moveItem(sectors, i, to))}
              />
            }
            normalize={formatSector}
          />
          <UnitList sector={s} selected={selected} onSelect={onSelect} onReorder={onReorder} />
        </div>
      ))}
    </>
  );
}

function UnitList({
  sector,
  selected,
  onSelect,
  onReorder,
}: {
  sector: SectorRow;
  selected: number | null;
  onSelect: (id: number) => void;
  onReorder: (table: AddressTable, rows: { id: number; sort_order: number }[]) => void;
}) {
  const units = sector.subsections;
  const drag = useDragOrder(units, (next) => onReorder('subsections', next));
  const write = useAddressWrite();
  return (
    <div className="flex flex-col gap-1.5 border-t border-divider pt-2.5">
      {units.map((u, i) => {
        const active = u.buildings.filter((b) => b.is_active).length;
        return (
          <div
            key={u.id}
            {...drag(i)}
            data-unit={u.name}
            className={`flex flex-wrap items-center gap-2 rounded-control px-2 py-1 ${
              selected === u.id ? 'bg-primary-soft' : ''
            } ${u.is_active ? '' : 'opacity-70'}`}
          >
            <button
              type="button"
              onClick={() => onSelect(u.id)}
              aria-pressed={selected === u.id}
              className="flex min-h-10 flex-1 items-center gap-2 text-right text-sm"
            >
              <span className="font-semibold">بلوك {u.name}</span>
              <span className="num text-xs text-text-muted">{active} بناية</span>
              {!u.is_active && <span className="text-xs text-warning-text">مخفية</span>}
            </button>
            <MoveButtons
              label={`بلوك ${u.name}`}
              index={i}
              count={units.length}
              onMove={(to) => onReorder('subsections', moveItem(units, i, to))}
            />
          </div>
        );
      })}
      <AddRow
        label={`بلوك جديد بـ${sector.name}`}
        placeholder="مثلاً: A10"
        compact
        onAdd={(name) =>
          write.mutateAsync((s) =>
            createSubsection(s, sector.id, name.toUpperCase(), (units.at(-1)?.sort_order ?? 0) + 1),
          )
        }
      />
    </div>
  );
}

/** عنوان الصف: الاسم، تعديله، الإخفاء، والترتيب. */
function RowHeader({
  table,
  row,
  label,
  value,
  title,
  move,
  normalize = (v) => v,
}: {
  table: AddressTable;
  row: { id: number; is_active: boolean };
  label: string;
  value: string;
  title: React.ReactNode;
  move?: React.ReactNode;
  normalize?: (v: string) => string;
}) {
  const { supabase } = usePanel();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  // إعادة التسمية تغيّر العنوان المحفوظ عند كل زبون يشير للصف: نعرض عددهم ونطلب تأكيداً (مراجعة T16-T19 M7)
  const [confirm, setConfirm] = useState<{ value: string; count: number } | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const write = useAddressWrite();
  const field = table === 'buildings' ? 'number' : 'name';
  const close = () => {
    setEditing(false);
    setConfirm(null);
    setLocalError(null);
  };
  const rename = async (v: string) => {
    await write
      .mutateAsync((s) => updateAddressRow(s, table, row.id, { [field]: v }))
      .then(close)
      .catch(() => undefined);
  };
  if (editing && confirm) {
    return (
      <div
        role="alertdialog"
        aria-label={`تأكيد تغيير الاسم لـ${label}`}
        data-testid="rename-confirm"
        className="flex flex-wrap items-center gap-2 rounded-control bg-warning-soft px-3 py-2 text-sm text-warning-text"
      >
        <span className="flex-1">
          <span className="num font-bold">{confirm.count}</span> عنوان محفوظ للزبائن راح يتغيّر عنده
          الاسم من «{value}» إلى «{confirm.value}». طلباتهم الجاية توصل للاسم الجديد. أكمل؟
        </span>
        <button
          type="button"
          data-testid="rename-confirm-yes"
          disabled={write.isPending}
          onClick={() => rename(confirm.value)}
          className="h-9 rounded-control bg-primary px-3 text-sm font-bold text-white disabled:opacity-60"
        >
          نعم، غيّر الاسم
        </button>
        <button
          type="button"
          onClick={() => setConfirm(null)}
          className="h-9 rounded-control border border-border bg-surface px-3 text-sm text-text"
        >
          رجوع
        </button>
        {write.error && (
          <span role="alert" className="basis-full text-xs text-danger">
            {duplicateMessage(write.error)}
          </span>
        )}
      </div>
    );
  }
  if (editing) {
    return (
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const v = normalize(draft.trim());
          if (!v || v === value) return close();
          if (table === 'buildings') {
            const invalid = validateBuildingNumber(v);
            if (invalid) return setLocalError(invalid);
          }
          setLocalError(null);
          setChecking(true);
          try {
            const count = await fetchAddressUsage(supabase, table, row.id);
            if (count > 0) setConfirm({ value: v, count });
            else await rename(v);
          } catch (error) {
            // نفشل مغلقين: بلا عدد العناوين المتأثرة لا نغيّر الاسم
            setLocalError(`تعذّر معرفة عدد العناوين المتأثرة: ${errorMessage(error)}`);
          } finally {
            setChecking(false);
          }
        }}
      >
        <input
          aria-label={`الاسم الجديد لـ${label}`}
          className={`${inputClass} h-10 w-40`}
          value={draft}
          maxLength={30}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button
          type="submit"
          disabled={checking}
          className="h-10 rounded-control bg-primary px-3 text-sm font-bold text-white disabled:opacity-60"
        >
          {checking ? 'جارٍ الفحص…' : 'حفظ'}
        </button>
        <button
          type="button"
          onClick={close}
          className="h-10 rounded-control border border-border px-3 text-sm"
        >
          إلغاء
        </button>
        {(localError || write.error) && (
          <span role="alert" className="basis-full text-xs text-danger">
            {localError ?? duplicateMessage(write.error)}
          </span>
        )}
      </form>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="flex-1">
        {title}
        {!row.is_active && <span className="text-xs text-warning-text"> (مخفي)</span>}
      </span>
      <button
        type="button"
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
        className="h-8 rounded-md border border-border px-2 text-xs"
      >
        تعديل الاسم
      </button>
      <button
        type="button"
        onClick={() =>
          write.mutate((s) => updateAddressRow(s, table, row.id, { is_active: !row.is_active }))
        }
        className="h-8 rounded-md border border-border px-2 text-xs"
      >
        {row.is_active ? 'إخفاء' : 'إظهار'}
      </button>
      {move}
    </div>
  );
}

function AddRow({
  label,
  placeholder,
  onAdd,
  compact,
}: {
  label: string;
  placeholder: string;
  onAdd: (name: string) => Promise<unknown>;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`rounded-control border border-dashed border-[#A9CDB3] text-sm text-primary ${compact ? 'h-9' : 'h-11'}`}
      >
        + {label}
      </button>
    );
  }
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const v = name.trim();
        if (!v) return setError('اكتب الاسم');
        try {
          await onAdd(v);
          setName('');
          setError(null);
          setOpen(false);
        } catch (err) {
          setError(duplicateMessage(err));
        }
      }}
    >
      <input
        aria-label={label}
        placeholder={placeholder}
        className={`${inputClass} h-10 w-44`}
        maxLength={30}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <button
        type="submit"
        className="h-10 rounded-control bg-primary px-3 text-sm font-bold text-white"
      >
        إضافة
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="h-10 rounded-control border border-border px-3 text-sm"
      >
        إلغاء
      </button>
      {error && (
        <span role="alert" className="basis-full text-xs text-danger">
          {error}
        </span>
      )}
    </form>
  );
}

function UnitBuildings({ unit }: { unit: SubsectionRow }) {
  const { supabase } = usePanel();
  const qc = useQueryClient();
  const [input, setInput] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [editing, setEditing] = useState<BuildingRow | null>(null);
  const parsed = input.trim() ? parseBuildingNumbers(input) : null;
  const preview = parsed?.numbers.length
    ? splitNew(
        parsed.numbers,
        unit.buildings.map((b) => b.number),
      )
    : null;

  const add = useMutation({
    mutationFn: (numbers: string[]) => addBuildings(supabase, unit.id, numbers),
    onSuccess: async (n) => {
      setResult(`انضافت ${n} بناية لبلوك ${unit.name}`);
      setInput('');
      await qc.invalidateQueries({ queryKey: adminKeys.addresses });
    },
  });
  return (
    <>
      <RowHeader
        table="subsections"
        row={unit}
        label={`بلوك ${unit.name}`}
        value={unit.name}
        title={<h2 className="m-0 inline text-[17px] font-bold">بلوك {unit.name}</h2>}
        normalize={(v) => v.toUpperCase()}
      />

      <form
        className="flex flex-col gap-2 rounded-control border border-dashed border-[#A9CDB3] p-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          setResult(null);
          if (preview && preview.fresh.length > 0) add.mutate(parsed?.numbers ?? []);
        }}
      >
        <label htmlFor="bulk-buildings" className="text-sm font-semibold">
          إضافة بنايات بالجملة
        </label>
        <span className="text-xs text-text-muted">مثال: 1-100 أو 1,2,5-9</span>
        <input
          id="bulk-buildings"
          dir="ltr"
          className={`${inputClass} num text-right`}
          value={input}
          onChange={(e) => {
            setResult(null);
            setInput(e.target.value);
          }}
        />
        {parsed?.error && (
          <span role="alert" className="text-xs text-danger">
            {parsed.error}
          </span>
        )}
        {preview && (
          <p className="m-0 text-[13px]" data-testid="bulk-preview">
            {preview.fresh.length > 0 ? (
              <>
                تنضاف <strong className="num">{preview.fresh.length}</strong> بناية:{' '}
                <span className="num">{compactRanges(preview.fresh)}</span>
              </>
            ) : (
              'كل الأرقام موجودة أصلاً'
            )}
            {preview.duplicates.length > 0 && (
              <span className="text-text-muted">
                {' '}
                · {preview.duplicates.length} موجودة أصلاً وتنتجاهل (
                <span className="num">{compactRanges(preview.duplicates)}</span>)
              </span>
            )}
          </p>
        )}
        <button
          type="submit"
          disabled={!preview || preview.fresh.length === 0 || add.isPending}
          className="h-10 rounded-[10px] bg-primary-soft text-sm font-semibold text-primary disabled:opacity-50"
        >
          {add.isPending
            ? 'جارٍ الإضافة…'
            : preview?.fresh.length
              ? `إضافة ${preview.fresh.length} بناية`
              : 'إضافة'}
        </button>
        {add.error && (
          <span role="alert" className="text-xs text-danger">
            {errorMessage(add.error)}
          </span>
        )}
        {result && (
          <span role="status" data-testid="bulk-result" className="text-sm text-primary">
            {result}
          </span>
        )}
      </form>

      <div className="flex flex-col gap-2">
        <span className="num text-sm text-text-muted">
          {unit.buildings.length} بناية ({unit.buildings.filter((b) => !b.is_active).length} مخفية).
          اضغط على بناية لتعديل رقمها أو إخفائها.
        </span>
        <div className="flex flex-wrap gap-1.5" data-testid="buildings">
          {unit.buildings.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => setEditing(b)}
              aria-pressed={editing?.id === b.id}
              className={`num h-9 min-w-11 rounded-[10px] border px-2 text-sm ${
                b.is_active
                  ? 'border-border bg-surface'
                  : 'border-dashed border-border bg-background text-text-muted line-through'
              } ${editing?.id === b.id ? 'border-primary' : ''}`}
            >
              {b.number}
            </button>
          ))}
        </div>
        {editing && (
          <div className="rounded-control bg-background p-3">
            <RowHeader
              key={editing.id}
              table="buildings"
              row={unit.buildings.find((b) => b.id === editing.id) ?? editing}
              label={`بناية ${editing.number}`}
              value={editing.number}
              title={<span className="text-sm font-semibold">بناية {editing.number}</span>}
              normalize={normalizePin}
            />
          </div>
        )}
      </div>
    </>
  );
}
