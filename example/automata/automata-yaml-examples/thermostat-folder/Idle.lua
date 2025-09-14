-- Idle state: cooler is off unless temp rises too high

function on_enter()
  setVal("cooler_on", false)
end

function body()
  -- Idle does nothing; transition will handle switching
end

