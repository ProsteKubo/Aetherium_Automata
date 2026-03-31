# Board-Specific Follow-Up

This file tracks hardware-facing work intentionally left out of the current engine-first implementation pass.

## ESP32 / Other Board Runtime Wiring

- Mirror the native Lua variable-sync fix into the embedded Lua runtime once board work resumes:
  - keep Lua globals aligned with `setVal` / `setOutput`
  - route Lua-to-runtime sync through `VariableStore` so output callbacks and traces stay correct
- Bind the engine deployment descriptor to real board identity:
  - stable instance ID
  - board placement labels
  - target class/capability reporting
- Expose real transport labels from board adapters instead of CLI-only metadata:
  - `serial`
  - `websocket`
  - future `ros2` if it remains in scope
- Feed board-side send/receive timestamps into the trace path:
  - transport enqueue timestamp
  - transport transmit timestamp
  - transport receive timestamp
  - handler execution timestamp
- Replace host-only fault scheduling with transport-aware injection points:
  - serial frame delay/drop/duplication
  - websocket frame delay/drop/duplication
  - disconnect/reconnect behavior driven by real adapter state
- Add persistent or streamed trace sinks suitable for embedded targets:
  - serial trace streaming
  - websocket trace upload
  - optional local storage buffering on ESP32

## IO / Hardware Surface

- Map automata black-box ports to actual board IO boundaries:
  - GPIO inputs/outputs
  - PWM
  - I2C peripherals
  - ADC/sensors
- Mark explicit fault injection points at those boundaries without modifying automata logic:
  - sensor read distortion
  - actuator command loss
  - intermittent peripheral unavailability
- Attach board-observed runtime counters to telemetry:
  - free heap
  - CPU/load approximation
  - battery voltage / charge estimation
  - transport queue depth
  - reconnect counters
  - measured link latency samples

## Protocol / Control Plane

- Extend protocol v2 framing or extensions for deployment and trace metadata when the wire contract is finalized.
- Decide which metadata is emitted on-board vs projected by the server:
  - placement
  - transport
  - peer instance
  - fault actions
- Add control-plane commands for switching validation vs production profiles on connected boards.
- Decide how board-reported battery and measured latency fold into the common deployment descriptor.

## Validation Work Once Boards Are Connected

- Run the same automaton locally and on ESP32 with the same trace schema.
- Verify that injected delay/drop/duplicate behavior is visible in traces from both host and board runs.
- Compare host timestamps against board timestamps and document clock skew handling.
- Compare simulated battery drain/latency budgets against real board measurements and calibrate the model.
