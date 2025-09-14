-- Cooling state: keep cooler on while temp is high

function on_enter()
  setVal("cooler_on", true)
end

function body()
  -- Could implement proportional control here in future
end

