function on_enter()
  setVal("heater_on", false)
  setVal("cycle_count", value("cycle_count") + 1)
  log("info", "hold: cycle complete")
end

function body()
  -- slight drift during hold
  local temp = value("core_temp")
  if temp > 25 then
    setVal("core_temp", temp - 1)
  end
end
