import { mapIngredient } from './barboraMapping.js'

/**
 * The mapping columns for an ingredient. A category the household picked by
 * hand is recorded as such and is never recomputed; everything else is the
 * mapper's proposal, which may be nothing at all.
 */
export function mappingFields(name, section, index, manualPath) {
  const stamp = new Date().toISOString()
  // No catalogue loaded means no opinion, not "no category": clearing the
  // columns here would quietly discard a mapping because a fetch was slow.
  if (index.byPath.size === 0 && !manualPath) return {}
  if (manualPath) {
    return {
      barbora_category_path: manualPath,
      barbora_mapping_reason: 'manual',
      barbora_mapping_source: 'manual',
      barbora_mapping_updated_at: stamp,
    }
  }
  const proposal = mapIngredient(name, section, index)
  if (!proposal) {
    return {
      barbora_category_path: null,
      barbora_mapping_reason: null,
      barbora_mapping_source: null,
      barbora_mapping_updated_at: null,
    }
  }
  return {
    barbora_category_path: proposal.path,
    barbora_mapping_reason: proposal.reason,
    barbora_mapping_source: 'automatic',
    barbora_mapping_updated_at: stamp,
  }
}
