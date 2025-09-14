-- State1.lua (Lua)
-- Entry points: body(), on_enter(), on_exit()

function on_enter()
    -- Initialize outputs/variables as needed
    setVal("out1", 0)
end

function body()
    -- Example: react to input changes and update outputs
    if check("in1") then
        local v = value("in1")
        setVal("out1", v)
        print("hello world")
    end
end

function on_exit()
    -- Optional cleanup
end
