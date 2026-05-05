import { Value } from "typebox/value";

export function Compile(schema: any) {
	return {
		Code: () => "",
		Check: (value: unknown) => Value.Check(schema, value),
		Errors: (value: unknown) => Value.Errors(schema, value),
		Decode: (value: unknown) => Value.Decode(schema, value),
		Encode: (value: unknown) => Value.Encode(schema, value),
		Parse: (value: unknown) => Value.Parse(schema, value),
	};
}

export const TypeCompiler = {
	Compile,
};
