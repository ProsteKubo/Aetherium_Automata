defmodule AetheriumServer.DeviceManagerTargetProfileDeployTest do
  use ExUnit.Case, async: false

  alias AetheriumServer.AethIrArtifact
  alias AetheriumServer.DeviceIngress
  alias AetheriumServer.DeviceManager
  alias AetheriumServer.DeviceSessionRef

  test "arduino target deploy compiles to aeth_ir_v1 and sends binary load_automata frame" do
    previous = System.get_env("AETHERIUM_DEPLOY_CHUNK_SIZE")
    System.put_env("AETHERIUM_DEPLOY_CHUNK_SIZE", "65535")

    on_exit(fn ->
      if previous == nil do
        System.delete_env("AETHERIUM_DEPLOY_CHUNK_SIZE")
      else
        System.put_env("AETHERIUM_DEPLOY_CHUNK_SIZE", previous)
      end
    end)

    suffix = Integer.to_string(:erlang.unique_integer([:positive]))
    device_id = "arduino-#{suffix}"
    automata_id = "uno-automata-#{suffix}"

    {:ok, _device} =
      DeviceManager.register_device(
        %{
          device_id: device_id,
          device_type: :arduino,
          capabilities: 0,
          protocol_version: 1,
          connector_id: "serial_test",
          connector_type: :serial,
          transport: "serial",
          link: "/dev/tty-test"
        },
        self()
      )

    # HELLO_ACK sent on registration
    assert_receive {:send_binary, _hello_ack}, 500

    assert {:ok, deployment} =
             DeviceManager.deploy_automata(automata_id, device_id, sample_automata(automata_id))

    assert deployment.target_profile == "avr_uno_v1"
    assert deployment.patch_mode == "replace_restart"

    assert_receive {:send_binary, load_frame}, 500

    assert {:ok, artifact_payload} = extract_load_automata_binary_payload(load_frame)
    assert {:ok, artifact} = AethIrArtifact.decode(artifact_payload)
    assert artifact.payload_kind == :engine_bytecode
    assert is_binary(artifact.payload)

    assert {:ok, load_chunk} = extract_load_chunk(load_frame)

    assert {:ok, ^device_id} =
             DeviceIngress.route(
               :load_ack,
               %{run_id: load_chunk.run_id, success: true, error: "", warnings: []},
               device_id,
               fake_session_ref()
             )
  end

  test "desktop target deploy uses yaml chunking path and completes via load_ack" do
    old_chunk = System.get_env("AETHERIUM_DEPLOY_CHUNK_SIZE")
    System.put_env("AETHERIUM_DEPLOY_CHUNK_SIZE", "64")

    on_exit(fn ->
      restore_env("AETHERIUM_DEPLOY_CHUNK_SIZE", old_chunk)
    end)

    suffix = Integer.to_string(:erlang.unique_integer([:positive]))
    device_id = "desktop-#{suffix}"
    automata_id = "desktop-automata-#{suffix}"

    {:ok, _device} =
      DeviceManager.register_device(
        %{
          device_id: device_id,
          device_type: :desktop,
          capabilities: 0xFFFF,
          protocol_version: 1,
          connector_id: "ws_test",
          connector_type: :websocket,
          transport: "websocket",
          link: "ws://local/test"
        },
        self()
      )

    assert_receive {:send_binary, _hello_ack}, 500

    assert {:ok, _deployment} =
             DeviceManager.deploy_automata(automata_id, device_id, sample_automata(automata_id))

    assert_receive {:send_binary, first_frame}, 500
    assert {:ok, first_chunk} = extract_load_chunk(first_frame)
    assert first_chunk.format == 0x02

    final_chunk =
      if first_chunk.total_chunks > 1 do
        Enum.reduce(1..(first_chunk.total_chunks - 1), first_chunk, fn _expected_index,
                                                                       previous_chunk ->
          assert {:ok, ^device_id} =
                   DeviceIngress.route(
                     :ack,
                     %{related_message_id: previous_chunk.message_id},
                     device_id,
                     fake_session_ref()
                   )

          assert_receive {:send_binary, next_frame}, 500
          assert {:ok, next_chunk} = extract_load_chunk(next_frame)
          assert next_chunk.format == 0x02
          next_chunk
        end)
      else
        first_chunk
      end

    assert {:ok, ^device_id} =
             DeviceIngress.route(
               :load_ack,
               %{run_id: final_chunk.run_id, success: true, error: "", warnings: []},
               device_id,
               fake_session_ref()
             )
  end

  test "esp32 target deploy compiles to aeth_ir_v1 and sends binary load_automata frame" do
    previous = System.get_env("AETHERIUM_DEPLOY_CHUNK_SIZE")
    System.put_env("AETHERIUM_DEPLOY_CHUNK_SIZE", "65535")

    on_exit(fn ->
      if previous == nil do
        System.delete_env("AETHERIUM_DEPLOY_CHUNK_SIZE")
      else
        System.put_env("AETHERIUM_DEPLOY_CHUNK_SIZE", previous)
      end
    end)

    suffix = Integer.to_string(:erlang.unique_integer([:positive]))
    device_id = "esp32-#{suffix}"
    automata_id = "esp32-automata-#{suffix}"

    {:ok, _device} =
      DeviceManager.register_device(
        %{
          device_id: device_id,
          device_type: :esp32,
          capabilities: 0,
          protocol_version: 1,
          connector_id: "serial_test",
          connector_type: :serial,
          transport: "serial",
          link: "/dev/tty-esp32-test"
        },
        self()
      )

    assert_receive {:send_binary, _hello_ack}, 500

    assert {:ok, deployment} =
             DeviceManager.deploy_automata(automata_id, device_id, sample_automata(automata_id))

    assert deployment.target_profile == "esp32_v1"
    assert deployment.patch_mode == "replace_restart"

    assert_receive {:send_binary, load_frame}, 500

    assert {:ok, artifact_payload} = extract_load_automata_binary_payload(load_frame)
    assert {:ok, artifact} = AethIrArtifact.decode(artifact_payload)
    assert artifact.payload_kind == :engine_bytecode
    assert artifact.source_label == "esp32_v1"

    assert {:ok, load_chunk} = extract_load_chunk(load_frame)

    assert {:ok, ^device_id} =
             DeviceIngress.route(
               :load_ack,
               %{run_id: load_chunk.run_id, success: true, error: "", warnings: []},
               device_id,
               fake_session_ref()
             )
  end

  test "arduino target deploy splits large payload into chunked load_automata frames" do
    previous = System.get_env("AETHERIUM_DEPLOY_CHUNK_SIZE")
    System.put_env("AETHERIUM_DEPLOY_CHUNK_SIZE", "64")

    on_exit(fn ->
      if previous == nil do
        System.delete_env("AETHERIUM_DEPLOY_CHUNK_SIZE")
      else
        System.put_env("AETHERIUM_DEPLOY_CHUNK_SIZE", previous)
      end
    end)

    suffix = Integer.to_string(:erlang.unique_integer([:positive]))
    device_id = "arduino-chunk-#{suffix}"
    automata_id = "uno-chunk-#{suffix}"

    {:ok, _device} =
      DeviceManager.register_device(
        %{
          device_id: device_id,
          device_type: :arduino,
          capabilities: 0,
          protocol_version: 1,
          connector_id: "serial_test",
          connector_type: :serial,
          transport: "serial",
          link: "/dev/tty-test"
        },
        self()
      )

    assert_receive {:send_binary, _hello_ack}, 500

    assert {:ok, _deployment} =
             DeviceManager.deploy_automata(automata_id, device_id, sample_automata(automata_id))

    assert_receive {:send_binary, first_frame}, 500
    assert {:ok, first_chunk} = extract_load_chunk(first_frame)
    assert first_chunk.chunked == 1
    assert first_chunk.chunk_index == 0

    final_chunk =
      if first_chunk.total_chunks > 1 do
        Enum.reduce(1..(first_chunk.total_chunks - 1), first_chunk, fn expected_index,
                                                                       previous_chunk ->
          assert {:ok, ^device_id} =
                   DeviceIngress.route(
                     :ack,
                     %{
                       related_message_id: previous_chunk.message_id,
                       info: "load_chunk_received"
                     },
                     device_id,
                     fake_session_ref()
                   )

          assert_receive {:send_binary, next_frame}, 500
          assert {:ok, next_chunk} = extract_load_chunk(next_frame)
          assert next_chunk.chunk_index == expected_index
          assert next_chunk.total_chunks == first_chunk.total_chunks
          next_chunk
        end)
      else
        first_chunk
      end

    assert final_chunk.chunk_index == first_chunk.total_chunks - 1

    assert {:ok, ^device_id} =
             DeviceIngress.route(
               :load_ack,
               %{run_id: final_chunk.run_id, success: true, error: "", warnings: []},
               device_id,
               fake_session_ref()
             )

    refute_receive {:send_binary, _extra_chunk}, 100
  end

  test "chunked deploy retries chunk on missing ack and eventually errors" do
    old_chunk = System.get_env("AETHERIUM_DEPLOY_CHUNK_SIZE")
    old_timeout = System.get_env("AETHERIUM_DEPLOY_CHUNK_ACK_TIMEOUT_MS")
    old_retries = System.get_env("AETHERIUM_DEPLOY_CHUNK_ACK_RETRIES")

    System.put_env("AETHERIUM_DEPLOY_CHUNK_SIZE", "64")
    System.put_env("AETHERIUM_DEPLOY_CHUNK_ACK_TIMEOUT_MS", "50")
    System.put_env("AETHERIUM_DEPLOY_CHUNK_ACK_RETRIES", "1")

    on_exit(fn ->
      restore_env("AETHERIUM_DEPLOY_CHUNK_SIZE", old_chunk)
      restore_env("AETHERIUM_DEPLOY_CHUNK_ACK_TIMEOUT_MS", old_timeout)
      restore_env("AETHERIUM_DEPLOY_CHUNK_ACK_RETRIES", old_retries)
    end)

    suffix = Integer.to_string(:erlang.unique_integer([:positive]))
    device_id = "arduino-retry-#{suffix}"
    automata_id = "uno-retry-#{suffix}"

    {:ok, _device} =
      DeviceManager.register_device(
        %{
          device_id: device_id,
          device_type: :arduino,
          capabilities: 0,
          protocol_version: 1,
          connector_id: "serial_test",
          connector_type: :serial,
          transport: "serial",
          link: "/dev/tty-test"
        },
        self()
      )

    assert_receive {:send_binary, _hello_ack}, 500

    assert {:ok, deployment} =
             DeviceManager.deploy_automata(automata_id, device_id, sample_automata(automata_id))

    assert_receive {:send_binary, first_frame}, 500
    assert {:ok, first_chunk} = extract_load_chunk(first_frame)
    assert first_chunk.chunk_index == 0

    assert_receive {:send_binary, retry_frame}, 500
    assert {:ok, retry_chunk} = extract_load_chunk(retry_frame)
    assert retry_chunk.chunk_index == 0

    Process.sleep(120)
    deployments = DeviceManager.get_device_deployments(device_id)
    current = Enum.find(deployments, &(&1.id == deployment.id))
    assert current.status == :error
  end

  test "final load_ack timeout retries final chunk and eventually errors" do
    old_chunk = System.get_env("AETHERIUM_DEPLOY_CHUNK_SIZE")
    old_chunk_timeout = System.get_env("AETHERIUM_DEPLOY_CHUNK_ACK_TIMEOUT_MS")
    old_final_timeout = System.get_env("AETHERIUM_DEPLOY_FINAL_LOAD_ACK_TIMEOUT_MS")
    old_retries = System.get_env("AETHERIUM_DEPLOY_CHUNK_ACK_RETRIES")

    System.put_env("AETHERIUM_DEPLOY_CHUNK_SIZE", "64")
    System.put_env("AETHERIUM_DEPLOY_CHUNK_ACK_TIMEOUT_MS", "50")
    System.put_env("AETHERIUM_DEPLOY_FINAL_LOAD_ACK_TIMEOUT_MS", "50")
    System.put_env("AETHERIUM_DEPLOY_CHUNK_ACK_RETRIES", "1")

    on_exit(fn ->
      restore_env("AETHERIUM_DEPLOY_CHUNK_SIZE", old_chunk)
      restore_env("AETHERIUM_DEPLOY_CHUNK_ACK_TIMEOUT_MS", old_chunk_timeout)
      restore_env("AETHERIUM_DEPLOY_FINAL_LOAD_ACK_TIMEOUT_MS", old_final_timeout)
      restore_env("AETHERIUM_DEPLOY_CHUNK_ACK_RETRIES", old_retries)
    end)

    suffix = Integer.to_string(:erlang.unique_integer([:positive]))
    device_id = "arduino-final-#{suffix}"
    automata_id = "uno-final-#{suffix}"

    {:ok, _device} =
      DeviceManager.register_device(
        %{
          device_id: device_id,
          device_type: :arduino,
          capabilities: 0,
          protocol_version: 1,
          connector_id: "serial_test",
          connector_type: :serial,
          transport: "serial",
          link: "/dev/tty-test"
        },
        self()
      )

    assert_receive {:send_binary, _hello_ack}, 500

    assert {:ok, deployment} =
             DeviceManager.deploy_automata(automata_id, device_id, sample_automata(automata_id))

    assert_receive {:send_binary, first_frame}, 500
    assert {:ok, first_chunk} = extract_load_chunk(first_frame)

    final_chunk =
      if first_chunk.total_chunks > 1 do
        Enum.reduce(1..(first_chunk.total_chunks - 1), first_chunk, fn _expected_index,
                                                                       previous_chunk ->
          assert {:ok, ^device_id} =
                   DeviceIngress.route(
                     :ack,
                     %{related_message_id: previous_chunk.message_id},
                     device_id,
                     fake_session_ref()
                   )

          assert_receive {:send_binary, next_frame}, 500
          assert {:ok, next_chunk} = extract_load_chunk(next_frame)
          next_chunk
        end)
      else
        first_chunk
      end

    assert_receive {:send_binary, retry_final_frame}, 500
    assert {:ok, retry_final_chunk} = extract_load_chunk(retry_final_frame)
    assert retry_final_chunk.chunk_index == final_chunk.chunk_index
    assert retry_final_chunk.run_id == final_chunk.run_id

    Process.sleep(120)
    deployments = DeviceManager.get_device_deployments(device_id)
    current = Enum.find(deployments, &(&1.id == deployment.id))
    assert current.status == :error
  end

  defp sample_automata(id) do
    %{
      id: id,
      name: "UNO Test",
      version: "1.0.0",
      states: %{
        "idle" => %{id: "idle", name: "Idle", type: :initial},
        "running" => %{id: "running", name: "Running", type: :normal}
      },
      transitions: %{
        "t1" => %{
          id: "t1",
          from: "idle",
          to: "running",
          type: :classic,
          condition: "enabled == true"
        }
      },
      variables: [
        %{id: "v1", name: "enabled", type: "bool", direction: :input, default: false}
      ]
    }
  end

  defp extract_load_automata_binary_payload(
         <<0xAE, 0x01, 0x01, 0x40, _len::16-big, _msg_id::32, _src_id::32, _target_id::32,
           _run_id::32, 0x01, _chunked::8, _chunk_index::16-big, _total_chunks::16-big,
           _start_after::8, _replace::8, payload_len::16-big, payload::binary-size(payload_len)>>
       ) do
    {:ok, payload}
  end

  defp extract_load_automata_binary_payload(_), do: {:error, :not_binary_load_automata}

  defp extract_load_chunk(
         <<0xAE, 0x01, 0x01, 0x40, _len::16-big, msg_id::32, _src_id::32, _target_id::32,
           run_id::32, format::8, chunked::8, chunk_index::16-big, total_chunks::16-big,
           _start_after::8, _replace::8, payload_len::16-big, payload::binary-size(payload_len)>>
       ) do
    {:ok,
     %{
       message_id: msg_id,
       run_id: run_id,
       format: format,
       chunked: chunked,
       chunk_index: chunk_index,
       total_chunks: total_chunks,
       payload: payload
     }}
  end

  defp extract_load_chunk(_), do: {:error, :not_load_chunk}

  defp restore_env(name, nil), do: System.delete_env(name)
  defp restore_env(name, value), do: System.put_env(name, value)

  defp fake_session_ref do
    %DeviceSessionRef{
      connector_id: "test_connector",
      connector_type: :serial,
      connector_module: AetheriumServer.DeviceConnectors.SerialConnector,
      session_id: "test_session"
    }
  end
end
