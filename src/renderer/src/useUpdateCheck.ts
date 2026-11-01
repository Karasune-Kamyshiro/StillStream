import { useCallback, useEffect, useRef, useState } from "react"
import type { UpdateSnapshot } from "../../shared/contracts"

/** Checked at launch and then every six hours, for an app that stays open on a TV. */
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

export type UpdateCheck = {
  readonly checking: boolean
  readonly checkNow: () => void
  readonly snapshot: UpdateSnapshot | undefined
}

/** Asks main whether a newer StillStream release exists; quiet when the check is unavailable. */
export const useUpdateCheck = (includePrereleases: boolean): UpdateCheck => {
  const [snapshot, setSnapshot] = useState<UpdateSnapshot>()
  const [checking, setChecking] = useState(false)
  const latestRequest = useRef(0)

  const checkNow = useCallback((): void => {
    const updates = window.stillStream?.updates
    if (updates === undefined) return
    const request = ++latestRequest.current
    setChecking(true)
    void updates.check(includePrereleases).then(
      (result) => {
        if (request !== latestRequest.current) return
        setSnapshot(result)
        setChecking(false)
      },
      () => {
        if (request === latestRequest.current) setChecking(false)
      },
    )
  }, [includePrereleases])

  useEffect(() => {
    checkNow()
    const interval = setInterval(checkNow, UPDATE_CHECK_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [checkNow])

  return { checkNow, checking, snapshot }
}
