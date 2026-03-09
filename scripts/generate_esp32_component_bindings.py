#!/usr/bin/env python3

import json
import sys
from pathlib import Path


def sanitize(name: str) -> str:
    chars = []
    for ch in name:
        chars.append(ch if ch.isalnum() else "_")
    return "".join(chars)


def render_component(component: dict) -> str:
    name = component["name"]
    symbol = sanitize(name)
    methods = component.get("methods", [])

    entries = []
    for method in methods:
        method_name = method["name"]
        entries.append(
            f'''                {{"{method_name}", [instance](const std::vector<aeth::Value>& args) -> aeth::Result<aeth::Value> {{
                    return instance->{method_name}(args);
                }}}}'''
        )

    entries_text = ",\n".join(entries) if entries else ""
    return f"""
inline void register_{symbol}_component(
    aeth::embedded::arduino::Esp32HardwareService& hardware,
    std::shared_ptr<{component["class"]}> instance
) {{
    hardware.registerComponent(std::make_unique<aeth::embedded::arduino::GenericComponent>(
        "{name}",
        std::vector<std::pair<std::string, aeth::embedded::arduino::GenericComponent::Handler>>{{
{entries_text}
        }}
    ));
}}
"""


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: generate_esp32_component_bindings.py <manifest.json> <output.hpp>", file=sys.stderr)
        return 1

    manifest_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    manifest = json.loads(manifest_path.read_text())
    components = manifest.get("components", [])

    body = "\n".join(render_component(component) for component in components)
    output = f"""#ifndef AETHERIUM_GENERATED_COMPONENT_BINDINGS_HPP
#define AETHERIUM_GENERATED_COMPONENT_BINDINGS_HPP

#include "engine/embedded/arduino/AetheriumEsp32Hardware.hpp"
#include <memory>
#include <vector>

namespace aeth::generated {{
{body}
}} // namespace aeth::generated

#endif // AETHERIUM_GENERATED_COMPONENT_BINDINGS_HPP
"""
    output_path.write_text(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
