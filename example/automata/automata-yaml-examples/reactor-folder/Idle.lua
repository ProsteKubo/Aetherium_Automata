function on_enter()
  setVal("heater_on", false)
  log("info", "idle: waiting for heating cycle")
end

function body()
  -- keep baseline stable while idle
  if value("core_temp") > 20 then
    setVal("core_temp", value("core_temp") - 1)
  end
end
