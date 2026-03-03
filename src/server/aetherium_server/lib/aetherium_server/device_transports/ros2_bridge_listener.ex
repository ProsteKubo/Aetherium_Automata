defmodule AetheriumServer.DeviceTransports.Ros2BridgeListener do
  @moduledoc false

  use GenServer
  require Logger

  defstruct connector_instance: nil,
            bind_ip: {0, 0, 0, 0},
            port: 5501,
            listen_socket: nil

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts)
  end

  @impl true
  def init(opts) do
    connector_instance = Keyword.fetch!(opts, :connector_instance)
    listener_config = Keyword.get(opts, :listener_config, [])
    bind_ip = parse_bind_ip(option(listener_config, :bind_ip, "0.0.0.0"))
    port = option(listener_config, :port, 5501) |> normalize_port(5501)

    state = %__MODULE__{
      connector_instance: connector_instance,
      bind_ip: bind_ip,
      port: port
    }

    case :gen_tcp.listen(port, tcp_listen_options(bind_ip)) do
      {:ok, listen_socket} ->
        Logger.info(
          "Starting ROS2 bridge connector #{connector_instance.id} on #{format_ip(bind_ip)}:#{port}"
        )

        send(self(), :accept_next)
        {:ok, %{state | listen_socket: listen_socket}}

      {:error, reason} ->
        Logger.error(
          "Failed to start ROS2 bridge connector #{connector_instance.id} on #{format_ip(bind_ip)}:#{port}: #{inspect(reason)}"
        )

        {:stop, {:listen_failed, reason}}
    end
  end

  @impl true
  def handle_info(:accept_next, %{listen_socket: listen_socket} = state) do
    case :gen_tcp.accept(listen_socket) do
      {:ok, socket} ->
        start_session(socket, state.connector_instance)
        send(self(), :accept_next)
        {:noreply, state}

      {:error, :closed} ->
        {:stop, :normal, state}

      {:error, reason} ->
        Logger.warning("ROS2 bridge accept error: #{inspect(reason)}")
        Process.send_after(self(), :accept_next, 200)
        {:noreply, state}
    end
  end

  def handle_info(_msg, state), do: {:noreply, state}

  @impl true
  def terminate(_reason, %{listen_socket: nil}), do: :ok

  def terminate(_reason, %{listen_socket: listen_socket}) do
    _ = :gen_tcp.close(listen_socket)
    :ok
  end

  defp start_session(socket, connector_instance) do
    peer = peer_label(socket)

    case AetheriumServer.DeviceTransports.Ros2BridgeSession.start_link(
           socket: socket,
           connector_instance: connector_instance,
           remote: peer
         ) do
      {:ok, pid} ->
        :ok = :gen_tcp.controlling_process(socket, pid)
        send(pid, :activate_socket)
        :ok

      {:error, reason} ->
        Logger.warning("Failed to start ROS2 bridge session (#{peer}): #{inspect(reason)}")
        _ = :gen_tcp.close(socket)
        :ok
    end
  end

  defp tcp_listen_options(bind_ip) do
    [
      :binary,
      {:packet, :line},
      {:active, false},
      {:reuseaddr, true},
      {:ip, bind_ip},
      {:nodelay, true},
      {:backlog, 128}
    ]
  end

  defp peer_label(socket) do
    case :inet.peername(socket) do
      {:ok, {ip, port}} -> "#{format_ip(ip)}:#{port}"
      _ -> "unknown"
    end
  end

  defp parse_bind_ip({_, _, _, _} = ip), do: ip
  defp parse_bind_ip({_, _, _, _, _, _, _, _} = ip), do: ip

  defp parse_bind_ip(ip) when is_binary(ip) do
    case :inet.parse_address(String.to_charlist(ip)) do
      {:ok, tuple} -> tuple
      {:error, _} -> {0, 0, 0, 0}
    end
  end

  defp parse_bind_ip(_), do: {0, 0, 0, 0}

  defp normalize_port(port, _default)
       when is_integer(port) and port > 0 and port <= 65_535,
       do: port

  defp normalize_port(port, default) when is_binary(port) do
    case Integer.parse(port) do
      {value, ""} -> normalize_port(value, default)
      _ -> default
    end
  end

  defp normalize_port(_port, default), do: default

  defp format_ip(tuple) do
    tuple
    |> :inet.ntoa()
    |> to_string()
  end

  defp option(opts, key, default) when is_list(opts), do: Keyword.get(opts, key, default)
  defp option(opts, key, default) when is_map(opts), do: Map.get(opts, key, default)
  defp option(_opts, _key, default), do: default
end
