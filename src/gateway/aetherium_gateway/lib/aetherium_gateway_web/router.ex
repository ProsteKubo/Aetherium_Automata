defmodule AetheriumGatewayWeb.Router do
  use AetheriumGatewayWeb, :router

  pipeline :api do
    plug :accepts, ["json"]
  end

  scope "/" do
    pipe_through :api

  end

end
