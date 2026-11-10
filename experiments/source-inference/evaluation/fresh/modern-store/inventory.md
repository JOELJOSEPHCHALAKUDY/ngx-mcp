# modern-store independent operation inventory

https://github.com/Ankur071/Modern-Store @ `5bface390202c117a30bb7de06839735d3b9f013`

* `cart-add-card`: ProductCard.store.addToCart — Insert a quantity-one cart row or increment the existing product row by one.
* `cart-add-detail`: ProductInfo.store.addToCart — Insert the selected product at requested quantity or add that quantity to the existing cart row.
* `wishlist-toggle`: ToggleWishlistButton.toggleWishlist — Toggle the product membership of wishlist; preserve cart.
* `wishlist-remove`: MyWishlist.store.removeFromWishlist — Remove matching product id from wishlist.
* `wishlist-clear`: MyWishlist.store.clearWishlist — Clear all wishlist rows.
* `cart-set-quantity`: ShowCartItem.store.setItemQuantity — Replace existing cart row quantity with selected quantity.
* `cart-move-to-wishlist`: ShowCartItem.store.moveToWishlist — Remove cart row and add product once to wishlist.
* `cart-remove`: ShowCartItem.store.removeFromCart — Remove all cart rows for matching product id.
* `wishlist-add-all-to-cart`: TeaseWishlist.store.addAllWishlistToCart — Add wishlist products absent from cart at quantity one and then clear entire wishlist.
* `session-sign-in`: SignInDialog.signIn — Set mock session user email, fixed id/name/avatar, close sign-in dialog; checkout context navigates to checkout.
* `session-sign-up`: SignUpDialog.signUp — Set mock session user and close dialog; require matching password confirmation before store invocation.
* `session-sign-out`: HeaderActions.store.signOut — Clear in-memory session user.
* `order-place`: Checkout.store.placeOrder — Simulate order processing, then clear cart and navigate to order success if a mock user exists.

## Exclusions

* catalog-and-route-navigation: Category route, detail route, header links and BackButton change navigation or query state only.
* proceed-to-checkout: Opens a SignInDialog or navigates to /checkout; does not mutate business data. The subsequent signIn/placeOrder operations are included.
* draft-quantity: ProductInfo.quantity.set edits draft purchase quantity; business mutation happens at addToCart. QtySelector output on an existing cart row is included via setItemQuantity.
* shipping-and-payment-drafts: ShippingForm validators and PaymentForm stripe selection have no submit handler, no output and no read in placeOrder. Inputs are disconnected drafts, not valid order-operation parameters.
* presentation-and-dialog-controls: Password visibility, open/close sign-in/sign-up dialogs, menu toggles, share button without handler, image transitions, toasts and loading presentation do not change domain state.

## Source and oracle notes

* All 13 source-defined business operation variants are included; main storage methods are 11 unique handlers plus quantity-specific add variant and wishlist-specific remove entry. No compiler output has influenced selection.
* Schemas intentionally separate context-bound typed Product arguments from user-editable form fields. UI bounds are not falsely attributed to missing store validation.
* Mock sign-up ignores provided name; authentication does not persist; order data is not saved. These are observed source limitations and part of business oracles, not benchmark exclusions.
* No new account, backend service or network payment is required. Unsplash/randomuser image requests may be intercepted without changing business semantics.
