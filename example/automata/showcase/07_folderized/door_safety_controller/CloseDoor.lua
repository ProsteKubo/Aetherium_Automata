function condition()
  return value("door_sensor") == false
end

function body()
  setVal("door_open_ticks", 0)
end
