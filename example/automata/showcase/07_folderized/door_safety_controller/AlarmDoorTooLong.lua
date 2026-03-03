function condition()
  local ticks = value("door_open_ticks") or 0
  return ticks >= 30
end

function body()
end
