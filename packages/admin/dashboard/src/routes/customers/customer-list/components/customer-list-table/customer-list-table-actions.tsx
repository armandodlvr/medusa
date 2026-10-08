import { PencilSquare } from "@medusajs/icons"
import { HttpTypes } from "@medusajs/types"
import { useTranslation } from "react-i18next"

import { ActionMenu } from "../../../../../components/common/action-menu"

export const CustomerActions = ({
  customer,
}: {
  customer: HttpTypes.AdminCustomer
}) => {
  const { t } = useTranslation()

  return (
    <ActionMenu
      groups={[
        {
          actions: [
            {
              icon: <PencilSquare />,
              label: t("actions.edit"),
              to: `/customers/${customer.id}/edit`,
            },
          ],
        },
      ]}
    />
  )
}
