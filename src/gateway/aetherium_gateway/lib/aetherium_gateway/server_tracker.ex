defmodule AetheriumGateway.ServerTracker do
  use GenServer
  require Logger

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
    # Map of server_id => %{pid: pid, last_heartbeat: timestamp, devices: list}
    {:ok, %{servers: %{}}}
  end

  @impl true
  def handle_call({:register, server_id, pid}, _from, %{servers: servers} = state) do
    if Map.has_key?(servers, server_id) do
      {:reply, {:error, :already_connected}, state}
    else
      # Monitor the connection
      ref = Process.monitor(pid)

      new_servers =
        Map.put(servers, server_id, %{
          pid: pid,
          ref: ref,
          last_heartbeat: DateTime.utc_now(),
          connected_at: DateTime.utc_now(),
          devices: [],
          devices_updated_at: nil
        })

      Logger.info("Server #{server_id} connected")
      {:reply, :ok, %{state | servers: new_servers}}
    end
  end

  @impl true
  def handle_call({:unregister, server_id}, _from, %{servers: servers} = state) do
    case Map.pop(servers, server_id) do
      {nil, _new_servers} ->
        {:reply, :ok, state}

      {info, new_servers} ->
        Process.demonitor(info.ref, [:flush])
        Logger.warn("Server #{server_id} disconnected")
        {:reply, :ok, %{state | servers: new_servers}}
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
  def handle_call(:list_servers, _from, %{servers: servers} = state) do
    server_list =
      Enum.map(servers, fn {server_id, info} ->
        %{
          server_id: server_id,
          status: "online",
          connected_at: info.connected_at,
          last_heartbeat: info.last_heartbeat
        }
      end)

    {:reply, server_list, state}
  end

  @impl true
  def handle_call(:list_devices, _from, %{servers: servers} = state) do
    devices_by_server =
      Enum.map(servers, fn {server_id, info} ->
        %{
          server_id: server_id,
          devices: info.devices || [],
          devices_updated_at: info.devices_updated_at
        }
      end)

    {:reply, devices_by_server, state}
  end

  @impl true
  def handle_call(:list_devices_flat, _from, %{servers: servers} = state) do
    flat =
      Enum.flat_map(servers, fn {server_id, info} ->
        Enum.map(info.devices || [], fn device ->
          device
          |> Map.new()
          |> Map.put_new("server_id", server_id)
        end)
      end)

    {:reply, flat, state}
  end

  @impl true
  def handle_cast({:heartbeat, server_id}, %{servers: servers} = state) do
    new_servers =
      Map.update(servers, server_id, nil, fn info ->
        %{info | last_heartbeat: DateTime.utc_now()}
      end)

    {:noreply, %{state | servers: new_servers}}
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

    {:noreply, %{state | servers: new_servers}}
  end

  # Handle server process crashes
  @impl true
  def handle_info({:DOWN, ref, :process, pid, _reason}, %{servers: servers} = state) do
    # Find which server crashed
    case Enum.find(servers, fn {_id, info} -> info.ref == ref end) do
      {server_id, _info} ->
        Logger.error("Server #{server_id} process crashed")
        new_servers = Map.delete(servers, server_id)
        {:noreply, %{state | servers: new_servers}}

      nil ->
        {:noreply, state}
    end
  end
end
