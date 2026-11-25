// Protection, CR 702.16: "protection from [quality]": a permanent with it can't be Damaged (702.16e), Enchanted or
// Equipped (702.16c-d), Blocked (702.16f) or Targeted (702.16b) by anything with that quality. Carried out for
// protection from a color and from multicolored; each instance is separate (702.16g).
package game

import types "../types"

protection_supported :: proc(k: types.Keyword_Protection) -> bool {
	#partial switch _ in k._0 {
	case types.ProtectionTarget_Color, types.ProtectionTarget_Multicolored:
		return true
	}
	return false
}

// Whether `o` has protection from `source` (an object: a spell, a permanent, an ability's source).
protected_from :: proc(o, source: ^types.GameObject) -> bool {
	if o == nil || source == nil do return false
	for k in o.keywords {
		p, is_protection := k.(types.Keyword_Protection)
		if !is_protection do continue
		#partial switch q in p._0 {
		case types.ProtectionTarget_Color:
			for c in source.color do if c == q._0 do return true
		case types.ProtectionTarget_Multicolored:
			if len(source.color) >= 2 do return true // CR 105.4: two or more colors
		}
	}
	return false
}
