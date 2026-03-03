function on_enter()
  setVal("siren", false)
end

function body()
  local ticks = value("door_open_ticks") or 0
  setVal("door_open_ticks", ticks + 1)
end
