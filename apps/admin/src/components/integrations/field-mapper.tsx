import React, { useState } from 'react';

interface Field {
  id: string;
  name: string;
  type?: string;
}

interface Mapping {
  id: string;
  sourceField: string;
  targetField: string;
  transform?: string;
  required?: boolean;
}

interface Props {
  sourceFields: Field[];
  targetFields: Field[];
  mappings: Mapping[];
  onChange: (m: Mapping[]) => void;
}

export const FieldMapper: React.FC<Props> = ({
  sourceFields,
  targetFields,
  mappings: initial,
  onChange,
}) => {
  const [mappings, setMappings] = useState<Mapping[]>(initial || []);
  const [counter, setCounter] = useState(0);

  const addMapping = () => {
    const newMap: Mapping = {
      id: `mapping-${Date.now()}-${counter}`,
      sourceField: '',
      targetField: '',
    };
    setCounter(counter + 1);
    const next = [...mappings, newMap];
    setMappings(next);
    onChange(next);
  };

  const update = (id: string, patch: Partial<Mapping>) => {
    const next = mappings.map((m) => (m.id === id ? { ...m, ...patch } : m));
    setMappings(next);
    onChange(next);
  };

  const remove = (id: string) => {
    const next = mappings.filter((m) => m.id !== id);
    setMappings(next);
    onChange(next);
  };

  return (
    <div>
      <div className="grid grid-cols-2 gap-4">
        {mappings.map((m) => (
          <div key={m.id} className="border p-3 rounded">
            <div className="mb-2 text-sm font-medium">Mapping</div>
            <label className="block text-xs">Source</label>
            <select
              value={m.sourceField}
              onChange={(e) => update(m.id, { sourceField: e.target.value })}
              className="w-full border rounded p-1 text-sm"
            >
              <option value="">-- select source --</option>
              {sourceFields.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>

            <label className="block text-xs mt-2">Target</label>
            <select
              value={m.targetField}
              onChange={(e) => update(m.id, { targetField: e.target.value })}
              className="w-full border rounded p-1 text-sm"
            >
              <option value="">-- select target --</option>
              {targetFields.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>

            <label className="block text-xs mt-2">Transform (optional)</label>
            <input
              value={m.transform ?? ''}
              onChange={(e) => update(m.id, { transform: e.target.value })}
              className="w-full border rounded p-1 text-sm"
            />

            <div className="mt-3 flex justify-end gap-2">
              <button className="text-sm text-red-600" onClick={() => remove(m.id)}>
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3">
        <button className="px-3 py-1 bg-gray-100 rounded" onClick={addMapping}>
          Add Field
        </button>
      </div>
    </div>
  );
};

export default FieldMapper;
