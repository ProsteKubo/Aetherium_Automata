function condition()
  return value("alarm_ack") == true and value("door_sensor") == false
end

function body()
  setVal("siren", false)
  setVal("door_open_ticks", 0)
end
