defmodule AetheriumGateway.ServerTracker do
  use GenServer
  require Logger
  alias AetheriumGateway.Persistence

  # API
  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  def register(server_id, pid) do
    GenServer.call(__MODULE__, {:register, server_id, pid})
  end

  def unregister(server_id) do
    GenServer.call(__MODULE__, {:unregister, server_id})
  end

  def heartbeat(server_id) do
    GenServer.cast(__MODULE__, {:heartbeat, server_id})
  end

  def get_server_pid(server_id) do
    GenServer.call(__MODULE__, {:get_pid, server_id})
  end

  def list_servers do
    GenServer.call(__MODULE__, :list_servers)
  end

  def update_devices(server_id, devices) when is_list(devices) do
    GenServer.cast(__MODULE__, {:update_devices, server_id, devices})
  end

  def list_devices do
    GenServer.call(__MODULE__, :list_devices)
  end

  def list_devices_flat do
    GenServer.call(__MODULE__, :list_devices_flat)
  end

  # GenServer callbacks
  @impl true
  def init(_opts) do
    recovered = Persistence.load_state("server_tracker_known", %{})

    # Map of server_id => %{pid: pid, ref: monitor_ref, last_heartbeat: ts, devices: list}
    # recovered keeps durable metadata from previous runs (offline until reconnected).
    {:ok, %{servers: %{}, recovered: recovered}}
  end

  @impl true
  def handle_call(
        {:register, server_id, pid},
        _from,
        %{servers: servers, recovered: recovered} = state
      ) do
    if Map.has_key?(servers, server_id) do
      {:reply, {:error, :already_connected}, state}
    else
      # Monitor the connection
      ref = Process.monitor(pid)

      prior = Map.get(recovered, server_id, %{})

      new_servers =
        Map.put(servers, server_id, %{
          pid: pid,
          ref: ref,
          last_heartbeat: DateTime.utc_now(),
          connected_at: Map.get(prior, :connected_at, DateTime.utc_now()),
          devices: Map.get(prior, :devices, []),
          devices_updated_at: Map.get(prior, :devices_updated_at, nil)
        })

      Logger.info("Server #{server_id} connected")
      next = %{state | servers: new_servers, recovered: Map.delete(recovered, server_id)}
      persist_known(next)
      {:reply, :ok, next}
    end
  end

  @impl true
  def handle_call(
        {:unregister, server_id},
        _from,
        %{servers: servers, recovered: recovered} = state
      ) do
    case Map.pop(servers, server_id) do
      {nil, _new_servers} ->
        {:reply, :ok, state}

      {info, new_servers} ->
        Process.demonitor(info.ref, [:flush])
        Logger.warning("Server #{server_id} disconnected")
        snapshot = snapshot_info(info, "offline")
        next = %{state | servers: new_servers, recovered: Map.put(recovered, server_id, snapshot)}
        persist_known(next)
        {:reply, :ok, next}
    end
  end

  @impl true
  def handle_call({:get_pid, server_id}, _from, %{servers: servers} = state) do
    case Map.get(servers, server_id) do
      nil -> {:reply, {:error, :not_found}, state}
      info -> {:reply, {:ok, info.pid}, state}
    end
  end

  @impl true
  def handle_call(:list_servers, _from, %{servers: servers, recovered: recovered} = state) do
    online =
      Enum.map(servers, fn {server_id, info} ->
        %{
          server_id: server_id,
          status: "online",
          connected_at: info.connected_at,
          last_heartbeat: info.last_heartbeat
        }
      end)

    offline =
      Enum.map(recovered, fn {server_id, info} ->
        %{
          server_id: server_id,
          status: "offline",
          connected_at: info[:connected_at],
          last_heartbeat: info[:last_heartbeat]
        }
      end)

    {:reply, online ++ offline, state}
  end

  @impl true
  def handle_call(:list_devices, _from, %{servers: servers, recovered: recovered} = state) do
    online =
      Enum.map(servers, fn {server_id, info} ->
        %{
          server_id: server_id,
          devices: info.devices || [],
          devices_updated_at: info.devices_updated_at
        }
      end)

    offline =
      Enum.map(recovered, fn {server_id, info} ->
        %{
          server_id: server_id,
          devices: info[:devices] || [],
          devices_updated_at: info[:devices_updated_at]
        }
      end)

    {:reply, online ++ offline, state}
  end

  @impl true
  def handle_call(:list_devices_flat, _from, %{servers: servers, recovered: recovered} = state) do
    online =
      Enum.flat_map(servers, fn {server_id, info} ->
        Enum.map(info.devices || [], fn device ->
          device
          |> Map.new()
          |> Map.put_new("server_id", server_id)
        end)
      end)

    online_ids =
      online
      |> Enum.map(&device_id_of/1)
      |> Enum.reject(&is_nil/1)
      |> MapSet.new()

    offline =
      Enum.flat_map(recovered, fn {server_id, info} ->
        Enum.map(info[:devices] || [], fn device ->
          device
          |> Map.new()
          |> Map.put_new("server_id", server_id)
          |> Map.put("status", "offline")
        end)
      end)
      |> Enum.reject(fn device ->
        case device_id_of(device) do
          nil -> false
          id -> MapSet.member?(online_ids, id)
        end
      end)

    {:reply, online ++ offline, state}
  end

  @impl true
  def handle_cast({:heartbeat, server_id}, %{servers: servers} = state) do
    new_servers =
      Map.update(servers, server_id, nil, fn info ->
        %{info | last_heartbeat: DateTime.utc_now()}
      end)

    next = %{state | servers: new_servers}
    persist_known(next)
    {:noreply, next}
  end

  @impl true
  def handle_cast({:update_devices, server_id, devices}, %{servers: servers} = state) do
    new_servers =
      Map.update(servers, server_id, nil, fn info ->
        %{
          info
          | devices: devices,
            devices_updated_at: DateTime.utc_now()
        }
      end)

    next = %{state | servers: new_servers}
    persist_known(next)
    {:noreply, next}
  end

  # Handle server process crashes
  @impl true
  def handle_info(
        {:DOWN, ref, :process, _pid, _reason},
        %{servers: servers, recovered: recovered} = state
      ) do
    # Find which server crashed
    case Enum.find(servers, fn {_id, info} -> info.ref == ref end) do
      {server_id, _info} ->
        Logger.error("Server #{server_id} process crashed")
        info = Map.fetch!(servers, server_id)
        new_servers = Map.delete(servers, server_id)
        snapshot = snapshot_info(info, "crashed")
        next = %{state | servers: new_servers, recovered: Map.put(recovered, server_id, snapshot)}
        persist_known(next)
        {:noreply, next}

      nil ->
        {:noreply, state}
    end
  end

  defp persist_known(state) do
    known =
      state.recovered
      |> Map.merge(
        Enum.into(state.servers, %{}, fn {server_id, info} ->
          {server_id, snapshot_info(info, "online")}
        end)
      )

    Persistence.save_state("server_tracker_known", known)
  end

  defp snapshot_info(info, status) do
    %{
      status: status,
      connected_at: info[:connected_at],
      last_heartbeat: info[:last_heartbeat],
      devices: info[:devices] || [],
      devices_updated_at: info[:devices_updated_at]
    }
  end

  defp device_id_of(device) when is_map(device) do
    Map.get(device, "id") || Map.get(device, :id)
  end
end
