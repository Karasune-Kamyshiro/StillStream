// A stand-in for flatpak-portal on a private session bus, for the self-update tests.
// Usage: node fake-flatpak-portal.cjs MODE  (done | empty | failed | refuse); prints "ready".
const dbus = require("@homebridge/dbus-native")

const mode = process.argv[2] ?? "done"
const bus = dbus.sessionBus()
const MONITOR = "/org/freedesktop/portal/Flatpak/update_monitor/1_42/0"
const variant = (type, value) => [type, value]
const progress = (fields) => [
  Object.entries(fields).map(([key, [type, value]]) => [key, variant(type, value)]),
]
const send = (fields) =>
  bus.sendSignal(
    MONITOR,
    "org.freedesktop.portal.Flatpak.UpdateMonitor",
    "Progress",
    "a{sv}",
    progress(fields),
  )

const spawned = []
bus.exportInterface(
  {
    CreateUpdateMonitor: () => MONITOR,
    Spawn: (cwd, argv, _fds, envs, flags) => {
      spawned.push({ argv: argv.map((arg) => arg.toString()), cwd: cwd.toString(), envs, flags })
      console.log(`spawn ${JSON.stringify(spawned.at(-1))}`)
      return 4242
    },
  },
  "/org/freedesktop/portal/Flatpak",
  {
    methods: {
      CreateUpdateMonitor: ["a{sv}", "o"],
      Spawn: ["ayaaya{uh}a{ss}ua{sv}", "u"],
    },
    name: "org.freedesktop.portal.Flatpak",
  },
)
bus.exportInterface(
  {
    Close: () => console.log("closed"),
    Update: () => {
      if (mode === "refuse") {
        const error = new Error("Update requires new permissions")
        error.dbusName = "org.freedesktop.portal.Error.NotAllowed"
        throw error
      }
      setTimeout(() => {
        if (mode === "empty") return send({ status: ["u", 1] })
        send({ n_ops: ["u", 2], op: ["u", 0], progress: ["u", 30], status: ["u", 0] })
        setTimeout(() => {
          send({ n_ops: ["u", 2], op: ["u", 1], progress: ["u", 70], status: ["u", 0] })
          setTimeout(() => {
            if (mode === "failed") {
              send({
                error: ["s", "org.freedesktop.Flatpak.Error.Aborted"],
                error_message: ["s", "Disk full"],
                status: ["u", 3],
              })
            } else send({ progress: ["u", 100], status: ["u", 2] })
          }, 20)
        }, 20)
      }, 20)
    },
  },
  MONITOR,
  {
    methods: { Close: ["", ""], Update: ["sa{sv}", ""] },
    name: "org.freedesktop.portal.Flatpak.UpdateMonitor",
    signals: { Progress: ["a{sv}", "info"] },
  },
)
bus.requestName("org.freedesktop.portal.Flatpak", 0x4, (error, reply) => {
  // 1: DBUS_REQUEST_NAME_REPLY_PRIMARY_OWNER; anything else means another portal holds the name.
  if (error || reply !== 1) {
    console.error("could not own org.freedesktop.portal.Flatpak", error ?? reply)
    process.exit(1)
  }
  console.log("ready")
})
