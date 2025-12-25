defmodule AetheriumServerTest do
  use ExUnit.Case
  doctest AetheriumServer

  test "greets the world" do
    assert AetheriumServer.hello() == :world
  end
end
