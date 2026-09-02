import type { CategoryIndex } from './barboraMapping'
import type { IngredientSection } from './types'

export type MappingColumns = {
  barbora_category_path?: string | null
  barbora_mapping_reason?: string | null
  barbora_mapping_source?: string | null
  barbora_mapping_updated_at?: string | null
}

export function mappingFields(
  name: string,
  section: IngredientSection,
  index: CategoryIndex,
  manualPath?: string | null,
): MappingColumns
