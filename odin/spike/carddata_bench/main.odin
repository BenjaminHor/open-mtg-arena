// Times parsing client/public/card-data.json natively (O-0 spike). Usage: carddata_bench <path>
package carddata_bench

import "core:encoding/json"
import "core:fmt"
import "core:os"
import "core:time"
import cd "../carddata"

main :: proc() {
	data, rerr := os.read_entire_file_from_path(os.args[1], context.allocator)
	if rerr != nil { fmt.eprintln("can't read", os.args[1], rerr); os.exit(1) }
	fmt.printf("bytes %v\n", len(data))

	t := time.now()
	value, err := cd.parse_generic(data)
	fmt.printf("generic parse: %v ms, err %v, cards %v\n", time.duration_milliseconds(time.since(t)), err, len(value.(json.Object)))

	t = time.now()
	cards, uerr := cd.parse_typed(data)
	fmt.printf("typed unmarshal: %v ms, err %v, cards %v\n", time.duration_milliseconds(time.since(t)), uerr, len(cards))
	c := cards["lightning bolt"]
	fmt.printf("lightning bolt: %v %v %v generic=%v\n", c.name, c.mana_cost.shards, c.card_type.core_types, c.mana_cost.generic)
	c = cards["grizzly bears"]
	fmt.printf("grizzly bears: %v %v %v/%v\n", c.name, c.card_type.subtypes, c.power, c.toughness)
}
