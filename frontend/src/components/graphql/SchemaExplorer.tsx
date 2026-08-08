import { Search, Database, Zap, ChevronRight, ChevronDown, Box } from 'lucide-react'
import { useState } from 'react'

interface SchemaField {
  name: string
  description?: string
  args?: { name: string; description?: string; type: FieldType }[]
  type: FieldType
}

interface FieldType {
  name?: string
  kind: string
  ofType?: { name?: string; kind: string }
}

interface SchemaType {
  kind: string
  name: string
  description?: string
  fields?: SchemaField[]
  inputFields?: SchemaField[]
  enumValues?: { name: string; description?: string }[]
}

interface SchemaData {
  queryType: { name: string }
  mutationType?: { name: string }
  subscriptionType?: { name: string }
  types: SchemaType[]
}

interface Props {
  schema: SchemaData
  onInsertField: (fieldPath: string) => void
}

function typeString(t: FieldType): string {
  if (t.name) return t.name
  if (t.kind === 'NON_NULL' && t.ofType) return typeString(t.ofType) + '!'
  if (t.kind === 'LIST' && t.ofType) return '[' + typeString(t.ofType) + ']'
  return t.kind
}

function findType(schema: SchemaData, name: string): SchemaType | undefined {
  return schema.types.find((t) => t.name === name)
}

export function SchemaExplorer({ schema, onInsertField }: Props) {
  const [search, setSearch] = useState('')
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set())
  const queryTypeName = schema.queryType?.name
  const mutationTypeName = schema.mutationType?.name

  const toggle = (name: string) => {
    setExpandedTypes((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const filteredTypes = schema.types.filter(
    (t) =>
      !t.name.startsWith('__') &&
      (!search || t.name.toLowerCase().includes(search.toLowerCase())),
  )

  const renderFields = (fields: SchemaField[], parentName: string, depth = 0) => (
    <div className="space-y-0.5">
      {fields.map((field) => {
        const fieldType = typeString(field.type)
        const baseType = field.type?.name || field.type?.ofType?.name || field.type?.ofType?.ofType?.name || ''
        const hasSubfields = field.type?.kind === 'OBJECT' || !!findType(schema, baseType)
        const fieldKey = `${parentName}.${field.name}`

        return (
          <div key={fieldKey}>
            <button
              type="button"
              onClick={() => {
                if (hasSubfields) toggle(fieldKey)
                else onInsertField(field.name)
              }}
              className="flex w-full items-start gap-1.5 rounded px-2 py-1 text-left text-[11px] leading-relaxed transition-colors hover:bg-muted/60"
              style={{ paddingLeft: 12 + depth * 14 }}
            >
              {hasSubfields && (
                <span className="mt-[3px] shrink-0">
                  {expandedTypes.has(fieldKey) ? (
                    <ChevronDown className="h-3 w-3 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-3 w-3 text-muted-foreground" />
                  )}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="font-medium text-foreground">{field.name}</span>
                {field.args?.length ? (
                  <span className="text-muted-foreground">
                    ({field.args.map((a) => a.name + ': ' + typeString(a.type)).join(', ')})
                  </span>
                ) : null}
                <span className="ml-1 text-muted-foreground/70">: {fieldType}</span>
              </span>
            </button>
            {hasSubfields && expandedTypes.has(fieldKey) && (
              <div>
                {(() => {
                  const subType = baseType ? findType(schema, baseType) : null
                  const subFields = subType?.fields || (field.type?.kind === 'OBJECT' ? [] : [])
                  return subFields.length > 0
                    ? renderFields(subFields, fieldKey, depth + 1)
                    : (
                      <div className="py-1 text-center text-[10px] text-muted-foreground/60" style={{ paddingLeft: 14 + (depth + 1) * 14 }}>
                        scalar type · no subfields
                      </div>
                    )
                })()}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )

  return (
    <div className="flex h-full flex-col">
      <div className="relative border-b border-border px-3 py-2">
        <Search className="absolute left-5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search types..."
          className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-3 text-[11px] outline-none focus:border-cyan-500/50"
        />
      </div>
      <div className="flex-1 overflow-auto p-1">
        {queryTypeName && (
          <div className="mb-3">
            <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Zap className="h-3 w-3 text-cyan-500" /> Query
            </div>
            {(() => {
              const qt = findType(schema, queryTypeName)
              return qt?.fields ? renderFields(qt.fields, queryTypeName) : null
            })()}
          </div>
        )}
        {mutationTypeName && (
          <div className="mb-3">
            <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Database className="h-3 w-3 text-violet-500" /> Mutation
            </div>
            {(() => {
              const mt = findType(schema, mutationTypeName)
              return mt?.fields ? renderFields(mt.fields, mutationTypeName) : null
            })()}
          </div>
        )}
        <div>
          <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Box className="h-3 w-3 text-amber-500" /> Types
          </div>
          <div className="space-y-0.5">
            {filteredTypes.map((t) => (
              <div key={t.name}>
                <button
                  type="button"
                  onClick={() => toggle(t.name)}
                  className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[11px] transition-colors hover:bg-muted/60"
                >
                  {expandedTypes.has(t.name) ? (
                    <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                    {t.name}
                  </span>
                  <span className="font-mono text-[9px] text-muted-foreground/60">
                    {t.kind === 'OBJECT' ? 'type' : t.kind === 'ENUM' ? 'enum' : t.kind === 'INPUT_OBJECT' ? 'input' : t.kind.toLowerCase()}
                  </span>
                </button>
                {expandedTypes.has(t.name) && (
                  <div className="ml-5">
                    {t.fields ? renderFields(t.fields, t.name) : t.enumValues ? (
                      <div className="space-y-0.5 py-1">
                        {t.enumValues.map((ev) => (
                          <div key={ev.name} className="px-2 text-[11px] text-muted-foreground">
                            {ev.name}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="py-1 text-center text-[10px] text-muted-foreground/60">
                        {t.kind === 'SCALAR' ? 'built-in scalar' : 'no preview available'}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
