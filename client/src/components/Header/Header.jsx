import React, { useState } from "react";
import "./Header.css";
import { BiMenuAltRight } from "react-icons/bi";
import { getMenuStyles } from "../../utils/common";
import useHeaderColor from "../../hooks/useHeaderColor";
import OutsideClickHandler from "react-outside-click-handler";
import { NavLink } from "react-router-dom";
import { Link } from "react-router-dom";
import { useAuth0 } from "@auth0/auth0-react";

const Header = () => {
  const [menuOpened, setMenuOpened] = useState(false);
  const headerColor = useHeaderColor();
  const { isLoading, isAuthenticated, user, loginWithRedirect, logout } =
    useAuth0();

  return (
    <section className="h-wrapper" style={{ background: headerColor }}>
      <div className="flexCenter innerWidth paddings h-container">
        {/* logo */}
        <Link to="/">
          <img src="./logo.png" alt="logo" width={100} />
        </Link>

        {/* menu */}
        <OutsideClickHandler
          onOutsideClick={() => {
            setMenuOpened(false);
          }}
        >
          <div
            // ref={menuRef}
            className="flexCenter h-menu"
            style={getMenuStyles(menuOpened)}
          >
            <NavLink to="/properties">Properties</NavLink>

            <a href="mailto:zainkeepscode@gmail.com">Contact</a>

            {/* No login state is shown until Auth0 has finished initialising */}
            {isLoading ? (
              <button className="button" disabled aria-busy="true">
                Login
              </button>
            ) : isAuthenticated ? (
              <>
                {user?.picture && (
                  <img
                    className="h-avatar"
                    src={user.picture}
                    alt={user.name ? `Logged in as ${user.name}` : "Your profile"}
                    referrerPolicy="no-referrer"
                  />
                )}
                <button
                  className="button"
                  onClick={() =>
                    logout({ logoutParams: { returnTo: window.location.origin } })
                  }
                >
                  Logout
                </button>
              </>
            ) : (
              <button className="button" onClick={() => loginWithRedirect()}>
                Login
              </button>
            )}
          </div>
        </OutsideClickHandler>

        {/* for medium and small screens */}
        <div
          className="menu-icon"
          onClick={() => setMenuOpened((prev) => !prev)}
        >
          <BiMenuAltRight size={30} />
        </div>
      </div>
    </section>
  );
};

export default Header;
