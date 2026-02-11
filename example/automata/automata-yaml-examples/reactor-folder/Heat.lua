function on_enter()
  setVal("heater_on", true)
  log("info", "heat: ramping core temperature")
end

function body()
  local temp = value("core_temp")
  setVal("core_temp", temp + 5)
end

function on_exit()
  setVal("heater_on", false)
end
